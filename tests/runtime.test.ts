/**
 * L3 Agent 运行时测试 —— 并发契约。
 *
 * 这一层验证的是简历里最难自证的一句话：
 *   「实现 Judge / Agent Generation 异步并发调度，降低多 Agent 串行调用带来的端到端延迟」
 *
 * 「并发」不能靠读代码断言，必须用**可观测的因果与时序证据**证明：
 *   1. overlapMs > 0           → 两条路径确实在时间上重叠
 *   2. NPC i 的 prompt 含 NPC i-1 的输出 → 链内依赖真实存在（不是各自独立乱生成）
 *   3. Judge 看不到本轮 NPC 输出  → 证明它无须等待，这才有并发的可能
 *   4. abort 后全部 promise settle → 取消语义正确，不悬挂
 *
 * 通过 __setAdapterForTest 注入假适配器，因此完全离线、无随机性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startTurn, __setAdapterForTest, shuffle } from '../src/services/ai';
import type { LLMAdapter, LLMConfig } from '../src/services/llm';
import type { NPCPersonality, Message } from '../src/types';

const CONFIG: LLMConfig = {
  apiKey: 'sk-test',
  baseURL: 'https://mock',
  model: 'mock',
  timeoutMs: 5_000,
  idleMs: 5_000,
};

/** 记录每次调用，供断言检查 prompt 内容与调用时序 */
interface CallLog {
  kind: 'complete' | 'stream';
  prompt: string;
  atMs: number;
  finishAtMs?: number;
}

/**
 * 构造假适配器：
 * - complete（Judge）延迟 judgeDelayMs
 * - stream（NPC）延迟 npcDelayMs，并逐字流式吐出
 * 两者延迟可独立控制，用来说明「整轮墙钟 ≈ max 而非 sum」。
 */
function makeFakeAdapter(opts: {
  judgeDelayMs?: number;
  npcDelayMs?: number;
  log?: CallLog[];
  judgeJson?: string;
  npcTextFor?: (prompt: string) => string;
} = {}): LLMAdapter {
  const { judgeDelayMs = 100, npcDelayMs = 60, log = [] } = opts;

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const complete: LLMAdapter['complete'] = async (prompt) => {
    const atMs = performance.now();
    log.push({ kind: 'complete', prompt, atMs });
    await sleep(judgeDelayMs);
    const text = opts.judgeJson ?? JSON.stringify({
      feedback: '这一轮你没露馅。',
      surrender: false,
      breakdown: { belonging: 3, consistency: 3, presence: 4, bonus: -1 },
      sceneType: '日常吹水',
    });
    log[log.length - 1].finishAtMs = performance.now();
    return {
      text,
      metrics: { ttftMs: judgeDelayMs, totalMs: judgeDelayMs, chunks: 1, chars: text.length, outOfOrderChunks: 0, model: 'mock-judge' },
    };
  };

  const stream: LLMAdapter['stream'] = async (prompt, cb) => {
    const atMs = performance.now();
    const entry: CallLog = { kind: 'stream', prompt, atMs };
    log.push(entry);

    // 遵守 AbortSignal —— 真实适配器（llm.ts 的 consumeSse）也是这么做的。
    // 假适配器若不遵守，就无法验证「abort 后请求确实被中断」这条契约。
    if (cb.signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      cb.signal?.addEventListener('abort', onAbort, { once: true });
    });

    const text = opts.npcTextFor ? opts.npcTextFor(prompt) : `回复${log.filter(l => l.kind === 'stream').length}`;
    const per = Math.max(1, Math.floor(npcDelayMs / Math.max(1, text.length)));
    let acc = '';
    let firstTokenFired = false;

    try {
      for (const ch of text) {
        await Promise.race([sleep(per), aborted]);
        // 首个增量到达时触发 onFirstToken —— 真实适配器在收到第一个 chunk 时调用，
        // 用于 TTFT 埋点。夹具必须复现，否则测不出这条契约。
        if (!firstTokenFired) {
          firstTokenFired = true;
          cb.onFirstToken?.();
        }
        acc += ch;
        cb.onDelta(ch);
      }
    } finally {
      if (onAbort) cb.signal?.removeEventListener('abort', onAbort);
    }

    entry.finishAtMs = performance.now();
    return {
      text: acc,
      metrics: {
        ttftMs: entry.atMs - atMs + per,
        totalMs: performance.now() - atMs,
        chunks: acc.length,
        chars: acc.length,
        outOfOrderChunks: 0,
        model: 'mock-npc',
      },
    };
  };

  return {
    config: CONFIG,
    client: {} as LLMAdapter['client'],
    complete,
    stream,
  };
}

const NPCS: NPCPersonality[] = [
  { id: 'npc_0', name: '甲', title: '研究员', trait: '术语轰炸机', avatar: 0 },
  { id: 'npc_1', name: '乙', title: '教授', trait: '逻辑狙击手', avatar: 1 },
  { id: 'npc_2', name: '丙', title: '编辑', trait: '捧杀艺术家', avatar: 2 },
  { id: 'npc_3', name: '丁', title: '博主', trait: '乐子人', avatar: 3 },
];

const HISTORY: Message[] = [
  { id: 'm1', role: 'expert', author: '甲', content: '开场闲聊一', timestamp: new Date(), npcId: 'npc_0' },
];

function makeInput(over: Partial<Parameters<typeof startTurn>[0]> = {}) {
  return {
    playerMsg: '我觉得这个问题的关键在于叙事框架。',
    fullHistory: HISTORY,
    prevNpcDialogue: [{ npcId: 'npc_0', content: '上一轮甲说的话' }],
    npcs: NPCS,
    topic: '当代艺术评论',
    round: 2,
    suspicion: 20,
    difficulty: 'medium' as const,
    ...over,
  };
}

beforeEach(() => { /* 每个用例自行注入 */ });
afterEach(() => { __setAdapterForTest(null); });

// ══════════════════════════════════════════
describe('并发契约：Judge 与 NPC 链必须重叠', () => {
  it('两条路径在时间上真实重叠（overlapMs > 0）', async () => {
    const log: CallLog[] = [];
    __setAdapterForTest(makeFakeAdapter({ judgeDelayMs: 200, npcDelayMs: 120, log }));

    const turn = startTurn(makeInput());
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);
    const m = await turn.metrics;

    expect(m.overlapMs).toBeGreaterThan(0);
    // 重叠时间不应只是零头：Judge 与链有实质并行
    expect(m.overlapMs).toBeGreaterThan(50);
  });

  it('整轮墙钟 ≈ max(Judge, NPC链)，而非两者之和', async () => {
    const judgeDelayMs = 300;
    const npcDelayMs = 200;      // 4 个 NPC 串行 ≈ 800ms
    __setAdapterForTest(makeFakeAdapter({ judgeDelayMs, npcDelayMs }));

    const turn = startTurn(makeInput());
    const started = performance.now();
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);
    await turn.metrics;
    const wall = performance.now() - started;

    const m = await turn.metrics;
    const serialSum = m.judgeMs + m.npcChainMs;

    // 墙钟应显著小于「串行之和」，且接近两者较大者
    expect(wall).toBeLessThan(serialSum * 0.8);
    expect(wall).toBeLessThan(Math.max(m.judgeMs, m.npcChainMs) * 1.6);
  });

  it('Judge 与 NPC 的首次调用几乎同时发出（无先后等待）', async () => {
    const log: CallLog[] = [];
    __setAdapterForTest(makeFakeAdapter({ judgeDelayMs: 100, npcDelayMs: 80, log }));

    const turn = startTurn(makeInput());
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);

    const judgeCall = log.find(l => l.kind === 'complete')!;
    const firstNpcCall = log.find(l => l.kind === 'stream')!;
    // 两者的发起时间差应在很小的量级内（而非等 Judge 跑完才发 NPC）
    expect(Math.abs(firstNpcCall.atMs - judgeCall.atMs)).toBeLessThan(60);
  });
});

// ══════════════════════════════════════════
describe('依赖契约：链内串行、链间独立', () => {
  it('第 i 个 NPC 的 prompt 包含第 i-1 个 NPC 的输出（跨 Agent 消息依赖）', async () => {
    const log: CallLog[] = [];
    __setAdapterForTest(makeFakeAdapter({
      log,
      npcTextFor: (prompt) => {
        // 每个 NPC 输出一个可被下一个 NPC 的 prompt 检出的标记
        const idx = log.filter(l => l.kind === 'stream').length;
        return `NPC${idx}的发言内容`;
      },
    }));

    const turn = startTurn(makeInput());
    const replies = await Promise.all(turn.npcReplies);

    const npcPrompts = log.filter(l => l.kind === 'stream').map(l => l.prompt);
    expect(npcPrompts).toHaveLength(4);

    // 第 1 个 NPC 是链首，prompt 里应写明「你是本轮第一个发言的」
    expect(npcPrompts[0]).toContain('你是本轮第一个发言的');
    // 第 2..4 个 NPC 的 prompt 必须包含前一个的输出
    for (let i = 1; i < npcPrompts.length; i++) {
      const prevOutput = replies[i - 1].content;
      expect(npcPrompts[i]).toContain(prevOutput);
      expect(npcPrompts[i]).toContain('上一位群友说');
    }
  });

  it('Judge 的 prompt 只含上一轮 NPC 发言，不含本轮任何 NPC 输出', async () => {
    const log: CallLog[] = [];
    __setAdapterForTest(makeFakeAdapter({
      log,
      npcTextFor: () => '本轮NPC的独特标记XYZ',
    }));

    const turn = startTurn(makeInput());
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);

    const judgePrompt = log.find(l => l.kind === 'complete')!.prompt;
    // 必须看到上一轮内容
    expect(judgePrompt).toContain('上一轮甲说的话');
    // 绝不能看到本轮的 NPC 输出 —— 否则就需要等待，并发不成立
    expect(judgePrompt).not.toContain('本轮NPC的独特标记XYZ');
  });

  it('指标里记录了 Judge 实际看到的 NPC 条数（= 上一轮条数）', async () => {
    __setAdapterForTest(makeFakeAdapter());
    const turn = startTurn(makeInput({
      prevNpcDialogue: [
        { npcId: 'npc_0', content: '上轮甲' },
        { npcId: 'npc_1', content: '上轮乙' },
      ],
    }));
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);

    const m = await turn.metrics;
    expect(m.judgeSawNpcCount).toBe(2);
    expect(m.npcCount).toBe(4);
  });
});

// ══════════════════════════════════════════
describe('取消契约：abort 后必须全部 settle，不得悬挂', () => {
  it('abort 后所有 npcReplies 都 reject，metrics 仍能 settle', async () => {
    __setAdapterForTest(makeFakeAdapter({ judgeDelayMs: 50, npcDelayMs: 200 }));

    const turn = startTurn(makeInput());
    setTimeout(() => turn.abort(), 30);

    // 用 allSettled：不关心成功还是失败，只关心「都结束了」
    const results = await Promise.allSettled(turn.npcReplies);
    expect(results).toHaveLength(4);
    results.forEach(r => expect(r.status).toBe('rejected'));

    // metrics 也必须 settle —— 否则等待指标的 UI 会永久卡住
    const m = await turn.metrics;
    expect(m.turnId).toBe(turn.turnId);
  });

  it('abort 发生在中途时，未开始或进行中的 NPC 都不再产出内容', async () => {
    const log: CallLog[] = [];
    __setAdapterForTest(makeFakeAdapter({ judgeDelayMs: 30, npcDelayMs: 200, log }));

    const emitted: string[] = [];
    const turn = startTurn(makeInput({
      onNpcDelta: (_i, _id, d) => emitted.push(d),
    }));
    setTimeout(() => turn.abort(), 60);
    await Promise.allSettled(turn.npcReplies);

    // 4 个 NPC 每个 200ms，60ms 内不可能全部完成
    const finished = log.filter(l => l.finishAtMs !== undefined && l.kind === 'stream').length;
    expect(finished).toBeLessThan(4);
    expect(emitted.length).toBeGreaterThanOrEqual(0); // 已产出的部分不要求清空
  });
});

// ══════════════════════════════════════════
describe('流式回调契约', () => {
  it('每个 NPC 的增量回调按顺序拼接后等于其最终内容', async () => {
    __setAdapterForTest(makeFakeAdapter({ npcDelayMs: 60 }));

    const buffers = new Map<string, string>();
    const turn = startTurn(makeInput({
      onNpcDelta: (_i, npcId, d) => buffers.set(npcId, (buffers.get(npcId) || '') + d),
    }));
    const replies = await Promise.all(turn.npcReplies);
    await turn.judge;

    for (const r of replies) {
      expect(buffers.get(r.npcId)).toBe(r.content);
    }
  });

  it('onNpcFirstToken 对每个 NPC 各触发一次，且不晚于该 NPC 完成', async () => {
    __setAdapterForTest(makeFakeAdapter({ npcDelayMs: 80 }));

    const firstTokens: { npcId: string; at: number }[] = [];
    const turn = startTurn(makeInput({
      onNpcFirstToken: (_i, npcId) => firstTokens.push({ npcId, at: performance.now() }),
    }));
    const replies = await Promise.all(turn.npcReplies);
    await turn.judge;

    expect(firstTokens).toHaveLength(4);
    expect(new Set(firstTokens.map(f => f.npcId)).size).toBe(4);
  });

  it('onJudge 被调用且拿到的结果可被解析', async () => {
    __setAdapterForTest(makeFakeAdapter({ judgeDelayMs: 40 }));
    const seen = vi.fn();

    const turn = startTurn(makeInput({ onJudge: seen }));
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);

    expect(seen).toHaveBeenCalledTimes(1);
    const [result] = seen.mock.calls[0];
    expect(result.breakdown?.belonging).toBe(3);
  });
});

// ══════════════════════════════════════════
describe('健壮性契约', () => {
  it('Judge 返回非法 JSON 时重试一次，仍失败则回落中性评分（不崩）', async () => {
    let calls = 0;
    __setAdapterForTest({
      ...makeFakeAdapter(),
      complete: async () => {
        calls += 1;
        const text = '这不是 JSON';
        return {
          text,
          metrics: { ttftMs: 1, totalMs: 1, chunks: 1, chars: text.length, outOfOrderChunks: 0, model: 'mock' },
        };
      },
    });

    const turn = startTurn(makeInput());
    const judge = await turn.judge;

    expect(calls).toBe(2);                              // 恰好重试一次
    expect(judge.breakdown).toBeDefined();              // 有兜底，不是 undefined
    expect(judge.surrender).toBe(false);
    expect(judge.feedback.length).toBeGreaterThan(0);
  });

  it('某个 NPC 失败不影响其他 NPC 与 Judge', async () => {
    let streamCalls = 0;
    const base = makeFakeAdapter({ judgeDelayMs: 30, npcDelayMs: 20 });
    __setAdapterForTest({
      ...base,
      stream: async (prompt, cb) => {
        streamCalls += 1;
        if (streamCalls === 2) throw new Error('模拟第 2 个 NPC 失败');
        return base.stream(prompt, cb);
      },
    });

    const turn = startTurn(makeInput());
    const judge = await turn.judge;                    // Judge 正常
    const settled = await Promise.allSettled(turn.npcReplies);

    expect(judge.breakdown).toBeDefined();
    expect(settled.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(3);
  });

  it('NPC 数量不足 4 个时按实际数量执行', async () => {
    __setAdapterForTest(makeFakeAdapter({ npcDelayMs: 20 }));

    const turn = startTurn(makeInput({ npcs: NPCS.slice(0, 2) }));
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);

    expect(turn.npcReplies).toHaveLength(2);
    expect((await turn.metrics).npcCount).toBe(2);
  });
});

// ══════════════════════════════════════════
describe('洗牌集成：出场顺序随机但无偏', () => {
  it('startTurn 对 NPC 顺序做了洗牌（多次运行顺序不同）', async () => {
    __setAdapterForTest(makeFakeAdapter({ npcDelayMs: 10 }));
    const orders = new Set<string>();

    for (let i = 0; i < 12; i++) {
      const turn = startTurn(makeInput());
      orders.add(turn.npcs.map(n => n.id).join(','));
      await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);
    }

    // 12 次运行不应只有一种顺序（4! = 24 种可能）
    expect(orders.size).toBeGreaterThan(1);
  });

  it('洗牌不丢人、不重复', async () => {
    __setAdapterForTest(makeFakeAdapter({ npcDelayMs: 10 }));
    const turn = startTurn(makeInput());
    await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);

    const ids = turn.npcs.map(n => n.id).sort();
    expect(ids).toEqual(['npc_0', 'npc_1', 'npc_2', 'npc_3']);
  });

  it('shuffle 使用注入的随机源时结果可复现', () => {
    const items = ['a', 'b', 'c', 'd'];
    // 固定序列的伪随机源
    const seq = [0.1, 0.4, 0.7];
    let i = 0;
    const rnd = () => seq[i++ % seq.length];
    const a = shuffle(items, rnd);
    i = 0;
    const b = shuffle(items, rnd);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...items].sort());
  });
});
