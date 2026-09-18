/**
 * SSE 流体检工具 —— 判定「乱序」发生在哪一侧。
 *
 * ┌─ 为什么需要它 ──────────────────────────────────────────────┐
 * │ 「输出乱序」是一个症状，不是根因。至少有四种机制会产生它：   │
 * │                                                             │
 * │   H1 传输层重排：代理/网关/隧道把 SSE 帧重排后交给客户端     │
 * │   H2 消费层重排：客户端多路并发消费，写入顺序错乱            │
 * │   H3 服务端内容损坏：模型/采样/推理层产出非法 token 序列      │
 * │   H4 服务端重排：服务端 SSE 本身就是乱序的                   │
 * │                                                             │
 * │ 四者的修法完全不同（换代理 / 改消费逻辑 / 换模型 / 上报厂商），│
 * │ 所以必须先判定，再修。靠肉眼看界面是分不出来的。             │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 判定原理：对同一份原始字节流做**两次独立解析**——
 *   解析 A：严格顺序跟踪（state machine），按字节到达顺序记录帧序
 *   解析 B：内容指纹比对，检查帧内容是否符合「单调递增」的生成序
 * 两者交叉即可把上面四种根因区分开。
 *
 * 纯函数，无 IO、无网络，可被测试完全覆盖。
 */

// ══════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════

/** 一次 SSE 帧的原始记录 */
export interface RawFrame {
  /** 在字节流中出现的序位（0-based）—— 这是「到达顺序」，不是生成顺序 */
  arrivalIndex: number;
  /** 该帧到达时的相对时间戳（ms），用于计算 inter-frame gap */
  atMs: number;
  /** `data:` 之后的原始载荷（未解析 JSON） */
  data: string;
  /** SSE `id:` 字段（若供应商提供），这是真正的生成序游标 */
  id?: string;
  /** 是否为注释/心跳帧（以 `:` 开头） */
  isComment: boolean;
  /** 原始字符数，用于估算该帧承载的 token 量 */
  size: number;
}

/** 一帧承载的文本增量（解析 JSON 后得到） */
export interface FrameContent {
  arrivalIndex: number;
  text: string;
  /** choices[0].index —— 注意这是「第几个候选」，单选场景恒为 0，不是序号 */
  choiceIndex?: number;
  finish: boolean;
  /** 该帧是否为 usage-only（delta 为空） */
  empty: boolean;
}

/** 违例类型 */
export type ViolationKind =
  | 'DUPLICATE_FRAME'      // 同一帧内容重复出现
  | 'ID_REGRESSION'        // 带 id 的帧，id 出现回退 → 服务端或传输层乱序
  | 'TEXT_REORDER'         // 文本块与期望序列不匹配，但块本身合法
  | 'GARBLED_CONTENT'      // 出现非法/损坏字符（非文字垃圾）
  | 'MID_STREAM_GAP'       // 帧间出现异常大的时间间隔（疑似挂起/重连）
  | 'FRAME_SPLIT'          // 单帧被切断成多次到达（正常现象，仅记录）
  | 'NO_ID_CURSOR';        // 供应商未提供 id，无法用游标判定

export interface Violation {
  kind: ViolationKind;
  arrivalIndex: number;
  detail: string;
  /** 该违例指向哪一侧（供汇总判断） */
  suggests: 'transport' | 'consumption' | 'server' | 'unknown';
}

export interface ParsedStream {
  frames: RawFrame[];
  contents: FrameContent[];
  /** 按到达顺序拼接的文本 */
  arrivalText: string;
  /** 检测到的违例 */
  violations: Violation[];
  /** 是否观测到帧被切断成多次到达 */
  observedFrameSplit: boolean;
  /** 帧间最大间隔（ms） */
  maxGapMs: number;
  /** 解析过程中是否出现过跨 buffer 的半帧 */
  hadPartialFrame: boolean;
}

// ══════════════════════════════════════════════
// 解析
// ══════════════════════════════════════════════

/**
 * 严格 SSE 解析：以空行分帧，支持跨 chunk 的半帧。
 *
 * 关键点：**必须缓冲到完整的空行才成帧**。
 * 直接把每个 reader chunk 当成一帧是最常见的实现错误，
 * 会让「一个 SSE 帧跨两次到达」被误判成两个残帧。
 */
export function parseSseStream(
  chunks: { atMs: number; text: string }[],
  opts: { expectedText?: string; gapThresholdMs?: number } = {},
): ParsedStream {
  const { expectedText, gapThresholdMs = 3_000 } = opts;

  const frames: RawFrame[] = [];
  const violations: Violation[] = [];
  let buffer = '';
  let hadPartialFrame = false;
  let observedFrameSplit = false;
  let lastAtMs = -1;
  let maxGapMs = 0;

  const emitFrame = (raw: string, atMs: number) => {
    const lines = raw.split('\n');
    let data = '';
    let id: string | undefined;
    let isComment = false;

    for (const line of lines) {
      if (line.startsWith(':')) { isComment = true; continue; }
      if (line.startsWith('id:')) { id = line.slice(3).trim(); continue; }
      if (line.startsWith('data:')) { 
        const piece = line.slice(5);
        // 多行 data: 按规范用换行拼接
        data += (data ? '\n' : '') + (piece.startsWith(' ') ? piece.slice(1) : piece);
      }
    }

    frames.push({
      arrivalIndex: frames.length,
      atMs,
      data,
      id,
      isComment,
      size: raw.length,
    });
  };

  for (const chunk of chunks) {
    if (lastAtMs >= 0) {
      const gap = chunk.atMs - lastAtMs;
      maxGapMs = Math.max(maxGapMs, gap);
      if (gap > gapThresholdMs) {
        violations.push({
          kind: 'MID_STREAM_GAP',
          arrivalIndex: frames.length,
          detail: `帧间间隔 ${Math.round(gap)}ms 超过阈值 ${gapThresholdMs}ms（疑似挂起 / 重连）`,
          suggests: 'transport',
        });
      }
    }
    lastAtMs = chunk.atMs;

    buffer += chunk.text;

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      emitFrame(raw, chunk.atMs);
    }

    // 缓冲区里残留未成帧的内容 → 说明发生了跨到达的帧切断。
    // 注意这里必须是「剩余内容里还有 data:」——若残留是完整帧的尾巴（如只剩 \n），不算切断。
    if (buffer.includes('data:')) {
      hadPartialFrame = true;
    }
  }

  // 流结束时若仍有残帧，按残帧处理
  if (buffer.trim()) {
    emitFrame(buffer, lastAtMs);
  }
  // 只要出现过「单帧跨多次到达」，就记录该事实（供报告与测试断言）
  observedFrameSplit = hadPartialFrame;

  // ── 内容解析 ──
  const contents: FrameContent[] = [];
  for (const f of frames) {
    if (f.isComment || !f.data || f.data === '[DONE]') continue;
    let obj: any;
    try { obj = JSON.parse(f.data); } catch {
      violations.push({
        kind: 'GARBLED_CONTENT',
        arrivalIndex: f.arrivalIndex,
        detail: `data 字段不是合法 JSON：${f.data.slice(0, 80)}`,
        suggests: 'server',
      });
      continue;
    }
    const choice = obj?.choices?.[0];
    const rawText = choice?.delta?.content;
    const text = typeof rawText === 'string' ? rawText : '';
    contents.push({
      arrivalIndex: f.arrivalIndex,
      text,
      choiceIndex: typeof choice?.index === 'number' ? choice.index : undefined,
      finish: choice?.finish_reason != null,
      empty: text === '',
    });
  }

  // ── 违例检测 ──
  const cursor = detectIdRegression(frames, contents, violations);
  detectDuplicates(contents, violations);
  if (expectedText !== undefined) {
    detectTextReorder(contents, expectedText, violations);
  }

  // 只有「内容帧」上的 id 才算有效生成序游标。
  // 仅终止帧带 id（如 id: <总数>）不构成游标 —— 判据必须落在内容帧上，
  // 否则会把「无游标的流」误判成「有游标」，进而给出错误的归因。
  if (cursor.status === 'absent') {
    violations.push({
      kind: 'NO_ID_CURSOR',
      arrivalIndex: 0,
      detail: '内容帧上没有 SSE id 字段，无法用生成序游标判定；只能依赖文本内容推断',
      suggests: 'unknown',
    });
  }

  return {
    frames,
    contents,
    arrivalText: contents.map(c => c.text).join(''),
    violations,
    observedFrameSplit,
    maxGapMs,
    hadPartialFrame,
  };
}

/**
 * 检测 id 游标回退。
 *
 * 游标只认**内容帧**上的 id：终止帧常带 `id: <总数>` 之类的值，
 * 那不是生成序游标。把终止帧算进来会让「无游标的流」被误判成有游标。
 */
function detectIdRegression(
  frames: RawFrame[],
  contents: FrameContent[],
  violations: Violation[],
): { status: 'absent' | 'monotonic' | 'regressed' } {
  // 找出承载了文本的帧，只看它们的 id
  const contentIndexes = new Set(contents.map(c => c.arrivalIndex));
  const cursorFrames = frames.filter(f => contentIndexes.has(f.arrivalIndex) && f.id !== undefined);

  if (cursorFrames.length === 0) return { status: 'absent' };

  let prev = -1;
  let regressed = false;
  for (const f of cursorFrames) {
    const n = Number.parseInt(f.id as string, 10);
    if (Number.isNaN(n)) continue;
    if (n < prev) {
      regressed = true;
      violations.push({
        kind: 'ID_REGRESSION',
        arrivalIndex: f.arrivalIndex,
        detail: `id 从 ${prev} 回退到 ${n} —— 帧顺序在到达客户端之前已被改变`,
        suggests: 'transport',
      });
    }
    prev = Math.max(prev, n);
  }
  return { status: regressed ? 'regressed' : 'monotonic' };
}

function detectDuplicates(contents: FrameContent[], violations: Violation[]): void {
  const seen = new Map<string, number>();
  for (const c of contents) {
    if (!c.text) continue;
    const prev = seen.get(c.text);
    if (prev !== undefined) {
      violations.push({
        kind: 'DUPLICATE_FRAME',
        arrivalIndex: c.arrivalIndex,
        detail: `内容 "${preview(c.text)}" 与第 ${prev} 帧重复`,
        suggests: 'transport',
      });
    } else {
      seen.set(c.text, c.arrivalIndex);
    }
  }
}

/**
 * 文本重排检测 —— 判定顺序问题（H1/H2）与内容问题（H3）的核心。
 *
 * 判据演进（记录一次真实的错误修正）：
 *
 * 第一版用「游标前进 + 回头看」的启发式。它有一个静默 bug：
 * 当某块的位置落在游标之前时，我把它当作「重复」跳过 —— 但**重排的块
 * 也会落在游标之前**。于是「第二句。第三句。第一句。」这种典型乱序
 * 被判成「无异常」。乱序检测器漏掉乱序，是最不能接受的失效模式。
 *
 * 现在改用「存在性 + 可排序性」判据，不依赖游标位置：
 *   1. 到达顺序直接拼接 == 期望文本        → 无乱序（内容与顺序都对）
 *   2. 每个块都能在期望文本中找到（贪心推进）→ 内容完好，仅顺序错
 *   3. 存在块在期望文本中找不到            → 内容损坏
 *
 * 判据 2 的贪心推进：对每块，从当前游标向后找**最近**的出现位置。
 * 全部找到 ⇒ 内容的**多重集合**是期望内容的子集且可重新排序成期望文本 ⇒ 纯顺序问题。
 */
function detectTextReorder(
  contents: FrameContent[],
  expectedText: string,
  violations: Violation[],
): void {
  const blocks = contents.map(c => c.text).filter(t => t.length > 0);
  if (blocks.length === 0) return;

  // 判据 0：到达顺序拼接恰好等于期望文本 → 无任何顺序问题
  const arrivalText = blocks.join('');
  if (arrivalText === expectedText) return;

  /**
   * 判据 1：把「紧邻重复的块」折叠掉之后如果等于期望文本，
   * 说明这纯粹是重复下发的产物 —— 顺序本身没错。
   *
   * 必要性：重放会造成「同一块出现在游标之前」的表象，
   * 与真正的乱序在贪心推进时表现相同。不先折叠，重复会被误报成乱序，
   * 进而把根因从「重连重放」误判成「顺序错乱」。
   */
  const collapsed: string[] = [];
  for (const b of blocks) {
    if (collapsed[collapsed.length - 1] !== b) collapsed.push(b);
  }
  if (collapsed.join('') === expectedText) return;

  const unknown: string[] = [];
  let cursor = 0;
  let reordered = 0;

  for (const b of blocks) {
    const at = expectedText.indexOf(b, cursor);
    if (at >= 0) {
      cursor = at + b.length;
    } else {
      unknown.push(b);
    }
  }

  // 判据 2/3：贪心推进失败的块，需区分「乱序」与「损坏」
  if (unknown.length > 0) {
    const trulyMissing: string[] = [];
    for (const b of unknown) {
      // 该块是否在期望文本中**存在**（不限位置）
      if (expectedText.includes(b)) reordered += 1;   // 存在但贪心推进失败 → 乱序
      else trulyMissing.push(b);                       // 根本不存在 → 内容损坏
    }

    if (trulyMissing.length > 0) {
      violations.push({
        kind: 'GARBLED_CONTENT',
        arrivalIndex: -1,
        detail: `${trulyMissing.length} 个文本块不在期望内容中：${trulyMissing.slice(0, 5).map(preview).join(' | ')}`,
        suggests: 'server',
      });
    }
  }

  if (reordered > 0 && arrivalText !== expectedText) {
    violations.push({
      kind: 'TEXT_REORDER',
      arrivalIndex: -1,
      detail: `${reordered}/${blocks.length} 个文本块位置与期望不符，但所有块内容均合法存在于期望文本中`,
      suggests: 'consumption',
    });
  }
}

const preview = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ══════════════════════════════════════════════
// 判定
// ══════════════════════════════════════════════

export type Verdict =
  | 'TRANSPORT_REORDER'      // H1：传输/代理层重排
  | 'CONSUMPTION_REORDER'    // H2：消费层重排
  | 'SERVER_CONTENT'         // H3：服务端内容损坏
  | 'SERVER_REORDER'         // H4：服务端 SSE 本身乱序
  | 'NO_DISORDER'            // 未检测到乱序
  | 'INCONCLUSIVE';          // 证据不足

export interface Diagnosis {
  verdict: Verdict;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string[];
  /** 若判定为顺序问题，指出是块级还是字符级 */
  granularity?: 'block' | 'char';
  violations: Violation[];
  stats: {
    frameCount: number;
    contentFrameCount: number;
    duplicateCount: number;
    reorderCount: number;
    garbledCount: number;
    maxGapMs: number;
    hadPartialFrame: boolean;
  };
}

export function diagnose(parsed: ParsedStream): Diagnosis {
  const { violations } = parsed;

  const count = (k: ViolationKind) => violations.filter(v => v.kind === k).length;
  const duplicateCount = count('DUPLICATE_FRAME');
  const reorderCount = count('TEXT_REORDER');
  const garbledCount = count('GARBLED_CONTENT');
  const idRegression = count('ID_REGRESSION');
  const hasId = !violations.some(v => v.kind === 'NO_ID_CURSOR');

  const stats = {
    frameCount: parsed.frames.length,
    contentFrameCount: parsed.contents.length,
    duplicateCount,
    reorderCount,
    garbledCount,
    maxGapMs: parsed.maxGapMs,
    hadPartialFrame: parsed.hadPartialFrame,
  };

  const reasoning: string[] = [];
  const d = (...lines: string[]) => reasoning.push(...lines);

  // ── 判定优先级：内容损坏 > 帧序游标违例 > 重复 > 文本序推断 ──
  //
  // 为什么按这个顺序：证据强度不同。
  //   · 内容损坏   —— 有/无 的布尔事实，最强
  //   · id 游标违例 —— 协议层给出的生成序，强证据，**不应被文本推断覆盖**
  //   · 重复        —— 明确的帧级事实
  //   · 文本序推断  —— 启发式，最弱，只在没有游标时使用
  //
  // 教训：早期版本让文本推断排在 id 游标之前，导致「带 id 的传输层重排」
  // 被误判（文本游标恰好凑巧匹配，掩盖了 id 回退这个强证据）。

  // ① 内容损坏：与顺序问题正交，必须最先判
  if (garbledCount > 0) {
    d(
      `检测到 ${garbledCount} 处内容违例（非法 JSON，或出现了期望内容中不存在的文本块）。`,
      '内容损坏与顺序错乱是两类不同的故障：前者说明「产出的内容本身不对」，后者说明「内容对但排列不对」。',
      '判据：所有文本块都能在期望内容中找到 → 顺序问题；出现期望内容中不存在的块 → 内容问题。',
      '修法不同：内容问题要查模型/推理层并上报厂商，顺序问题要改消费或传输。',
    );
    return { verdict: 'SERVER_CONTENT', confidence: 'high', reasoning, violations, stats };
  }

  // ② 帧序游标违例：协议层强证据，优先于文本推断
  if (hasId && idRegression > 0) {
    d(
      `SSE 提供了 id 游标，且观测到 ${idRegression} 次 id 回退。`,
      'id 是服务端给出的生成序，属于协议层证据。id 回退意味着帧在「到达客户端之前」顺序已被改变，',
      '因此根因在传输路径（代理 / 网关 / 隧道）或服务端本身，而不是客户端消费逻辑。',
    );
    return {
      verdict: 'TRANSPORT_REORDER',
      confidence: 'high',
      reasoning,
      granularity: 'block',
      violations,
      stats,
    };
  }

  // ③ 重复：断流重连重放的特征
  if (duplicateCount > 0 && reorderCount === 0) {
    d(
      `检测到 ${duplicateCount} 处重复帧，且未检测到重排。`,
      '重复的最可能来源是断流重连后服务端从旧游标重放，也可能来自代理层重试。',
      '重复不等于乱序：内容顺序是对的，只是同一段被下发了多次。',
    );
    return { verdict: 'TRANSPORT_REORDER', confidence: 'medium', reasoning, violations, stats };
  }

  // ④ 文本序推断：弱证据，只在无游标时使用
  if (reorderCount > 0) {
    if (!hasId) {
      d(
        `检测到 ${reorderCount} 处文本重排，但 SSE 未提供 id 游标。`,
        '关键限制：没有游标时，「帧在传输途中被重排」与「帧到达有序但消费者拼接错乱」',
        '产生的原始字节流**完全一样** —— 单份字节流无法区分二者，这是信息论层面的限制，不是工具不够好。',
        '因此必须做对照实验：把**同一份**字节流喂给两个独立消费者 ——',
        '（A）按到达顺序直接拼接（基准），（B）客户端真实消费逻辑。',
        '若 A 正确、B 错乱 → 消费层（客户端）；若 A 本身也错乱 → 传输层或服务端。',
        '补充建议：优先抓带 id 字段的流，有游标才能一次判定。',
      );
      return {
        verdict: 'INCONCLUSIVE',
        confidence: 'low',
        reasoning,
        granularity: 'block',
        violations,
        stats,
      };
    }

    d('检测到文本重排，但 id 游标单调递增 —— 到达顺序本身是正确的，因此疑点在消费侧拼接逻辑。');
    return {
      verdict: 'CONSUMPTION_REORDER',
      confidence: 'medium',
      reasoning,
      granularity: 'block',
      violations,
      stats,
    };
  }

  d('未检测到重排、重复或内容损坏。');
  return { verdict: 'NO_DISORDER', confidence: 'high', reasoning, violations, stats };
}

/** 把判定结果渲染成可读报告 */
export function renderReport(d: Diagnosis, parsed: ParsedStream): string {
  const label: Record<Verdict, string> = {
    TRANSPORT_REORDER: '传输/代理层重排（H1）',
    CONSUMPTION_REORDER: '消费层重排（H2）',
    SERVER_CONTENT: '服务端内容损坏（H3）',
    SERVER_REORDER: '服务端帧序错乱（H4）',
    NO_DISORDER: '未检测到乱序',
    INCONCLUSIVE: '证据不足，无法判定',
  };

  const lines = [
    '════════ SSE 流体检报告 ════════',
    `判定      : ${label[d.verdict]}`,
    `置信度    : ${d.confidence}`,
    d.granularity ? `粒度      : ${d.granularity === 'block' ? '块级（词/词组整体位移）' : '字符级'}` : '',
    '',
    '── 统计 ──',
    `帧总数        : ${d.stats.frameCount}`,
    `内容帧        : ${d.stats.contentFrameCount}`,
    `重复帧        : ${d.stats.duplicateCount}`,
    `重排处数      : ${d.stats.reorderCount}`,
    `内容损坏处数  : ${d.stats.garbledCount}`,
    `最大帧间隔    : ${Math.round(d.stats.maxGapMs)}ms`,
    `观测到帧切断  : ${d.stats.hadPartialFrame ? '是' : '否'}`,
    '',
    '── 判定依据 ──',
    ...d.reasoning.map((r, i) => `${i + 1}. ${r}`),
  ];

  if (d.violations.length > 0) {
    lines.push('', '── 违例明细 ──');
    for (const v of d.violations.slice(0, 20)) {
      lines.push(`[${v.kind}] 帧#${v.arrivalIndex} → 指向 ${v.suggests}：${v.detail}`);
    }
    if (d.violations.length > 20) lines.push(`…（共 ${d.violations.length} 条）`);
  }

  return lines.filter(l => l !== '').join('\n');
}
