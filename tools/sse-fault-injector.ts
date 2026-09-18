/**
 * SSE 故障注入器 —— 生成「已知根因」的坏流，用于验证检测工具本身。
 *
 * 这是元测试（meta-test）的基础：要证明一个诊断工具是可信的，
 * 必须先拿已知答案的样本喂它，确认它判对。
 * 否则工具的输出只是另一个猜测。
 *
 * 每种注入都标注了 groundTruth，测试会断言 diagnose() 的输出与之相符。
 */
import type { Verdict } from './sse-inspector';

export interface InjectedChunk {
  atMs: number;
  text: string;
}

export interface Scenario {
  name: string;
  /** 这份坏流真正的根因（标准答案） */
  groundTruth: Verdict;
  /** 该场景下「期望的正确文本」—— 即如果一切正常应该产出什么 */
  expectedText: string;
  chunks: InjectedChunk[];
  notes: string;
}

/** 构造一个 SSE data 帧 */
function frame(payload: unknown, id?: number): string {
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  return `${idLine}data: ${JSON.stringify(payload)}\n\n`;
}

/** 构造 OpenAI 兼容的流式分片体 */
function chunk(content: string, finish: string | null = null) {
  return {
    id: 'chatcmpl-sim',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'sim',
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
  };
}

/** 把一批内容帧 + 终止帧组装成 SSE 文本序列 */
function toChunks(
  pieces: { text: string; id?: number }[],
  opts: { gapMs?: number; withDone?: boolean; withFinishId?: boolean } = {},
): InjectedChunk[] {
  const { gapMs = 20, withDone = true, withFinishId = true } = opts;
  const out: InjectedChunk[] = [];
  let t = 0;
  for (const p of pieces) {
    out.push({ atMs: t, text: frame(chunk(p.text), p.id) });
    t += gapMs;
  }
  if (withDone) {
    // withFinishId=false 用于构造「完全没有 id 字段」的流
    out.push({ atMs: t, text: frame(chunk('', 'stop'), withFinishId ? pieces.length : undefined) });
    t += gapMs;
    out.push({ atMs: t, text: 'data: [DONE]\n\n' });
  }
  return out;
}

// ══════════════════════════════════════════════
// 四个有已知答案的场景
// ══════════════════════════════════════════════

/**
 * 场景 1：完全正常。
 * 期望：NO_DISORDER
 */
export function scenarioHealthy(): Scenario {
  const blocks = ['结构整体：', '清晰。', '核心是 Service Memory，', '由 Retrieve 与 Update 两阶段构成。'];
  return {
    name: '正常流',
    groundTruth: 'NO_DISORDER',
    expectedText: blocks.join(''),
    chunks: toChunks(blocks.map((text, id) => ({ text, id }))),
    notes: '基线：所有帧按生成序到达，带 id 游标',
  };
}

/**
 * 场景 2：传输层重排（H1）。
 * 帧在到达客户端之前顺序被改变，**但 id 字段保留** → id 会回退。
 * 期望：TRANSPORT_REORDER
 */
export function scenarioTransportReorder(): Scenario {
  const blocks = ['A段。', 'B段。', 'C段。', 'D段。'];
  const pieces = blocks.map((text, id) => ({ text, id }));
  // 把第 3、4 块提到第 1、2 块之前 —— id 随之回退
  const shuffled = [pieces[2], pieces[3], pieces[0], pieces[1]];
  return {
    name: '传输层重排（id 会回退）',
    groundTruth: 'TRANSPORT_REORDER',
    expectedText: blocks.join(''),
    chunks: toChunks(shuffled),
    notes: '代理/隧道把帧重排后转发；id 游标暴露了这一点',
  };
}

/**
 * 场景 3：服务端内容损坏（H3）。
 * 出现期望内容中不存在的块 / 非法 JSON。
 * 期望：SERVER_CONTENT
 */
export function scenarioContentCorruption(): Scenario {
  const good = ['正常开头。', '然后这里被污染了。'];
  const chunks: InjectedChunk[] = toChunks(
    good.map((text, id) => ({ text, id })),
    { withDone: false },
  );
  // 注入一个非法的 payload（模拟 MoE 数值异常 / 特殊 token 泄漏）
  chunks.push({ atMs: 60, text: 'data: {"choices":[{"delta":{"content":"<|endof"}\n\n' });
  chunks.push({ atMs: 80, text: frame(chunk('乱码乱码乱码')) });
  chunks.push({ atMs: 100, text: frame(chunk('', 'stop')) });
  chunks.push({ atMs: 120, text: 'data: [DONE]\n\n' });
  return {
    name: '服务端内容损坏（含非法 JSON）',
    groundTruth: 'SERVER_CONTENT',
    expectedText: good.join(''),
    chunks,
    notes: '模型/推理层产出损坏内容，不是顺序问题',
  };
}

/**
 * 场景 4：重复帧（断流重连重放）。
 * 期望：TRANSPORT_REORDER（重复归入传输侧）
 */
export function scenarioDuplicates(): Scenario {
  const blocks = ['重', '复', '测', '试'];
  const pieces = blocks.map((text, id) => ({ text, id }));
  // 每个块下发两次：模拟重连后服务端从旧游标重发
  const dup = pieces.flatMap(p => [p, { ...p }]);
  return {
    name: '重复帧（重连重放）',
    groundTruth: 'TRANSPORT_REORDER',
    expectedText: blocks.join(''),
    chunks: toChunks(dup),
    notes: '每个分片下发两次',
  };
}

/**
 * 场景 5：无 id 游标的乱序。
 *
 * ⚠️ 这个场景的 groundTruth 是 INCONCLUSIVE，这是**刻意的**，不是妥协：
 * 没有游标时，「帧在传输途中被重排」与「帧到达有序但消费者拼接错乱」
 * 产生的原始字节流**完全一样**。任何工具都无法从单份字节流区分二者 ——
 * 必须做对照实验（同一份字节流喂两个消费者）。
 *
 * 把 groundTruth 标成 TRANSPORT_REORDER 才是错的：那是猜测，不是判定。
 * 这条用例的价值恰恰在于锁住「工具必须承认能力边界」这个行为。
 */
export function scenarioReorderWithoutCursor(): Scenario {
  const blocks = ['第一句。', '第二句。', '第三句。'];
  const pieces = blocks.map(text => ({ text }));  // 故意不带 id
  const shuffled = [pieces[1], pieces[2], pieces[0]];
  return {
    name: '乱序但无 id 游标',
    groundTruth: 'INCONCLUSIVE',
    expectedText: blocks.join(''),
    // withFinishId=false：连终止帧也不带 id，构造「完全没有游标」的流
    chunks: toChunks(shuffled, { withFinishId: false }),
    notes: '无游标 → 传输侧重排与消费侧错乱的字节流等价 → 必须判证据不足',
  };
}

/**
 * 场景 6：帧跨多次到达被切断（正常现象，不应误判为乱序）。
 * 期望：NO_DISORDER
 */
export function scenarioFrameSplit(): Scenario {
  const blocks = ['这条帧会被', '切成好几段下发。'];
  const full = toChunks(blocks.map((text, id) => ({ text, id })));
  const chunks: InjectedChunk[] = [];
  for (const c of full) {
    // 把一个 SSE 帧从中间切成 3 段，**同一帧的所有字节段共享同一时间戳** ——
    // 若给每段递增时间戳，会人为制造出并不存在的帧间隔，
    // 让 MID_STREAM_GAP 误报。这是夹具自身的一个真实陷阱。
    const size = Math.ceil(c.text.length / 3);
    for (let i = 0; i < c.text.length; i += size) {
      chunks.push({ atMs: c.atMs, text: c.text.slice(i, i + size) });
    }
  }
  return {
    name: '帧被切断成多次到达',
    groundTruth: 'NO_DISORDER',
    expectedText: blocks.join(''),
    chunks,
    notes: '正常的 TCP 分片行为，必须能和真正的乱序区分开',
  };
}

/** 全部场景 */
export function allScenarios(): Scenario[] {
  return [
    scenarioHealthy(),
    scenarioTransportReorder(),
    scenarioContentCorruption(),
    scenarioDuplicates(),
    scenarioReorderWithoutCursor(),
    scenarioFrameSplit(),
  ];
}
