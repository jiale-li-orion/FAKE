/**
 * Agent 运行时 —— 多 Agent 调度层。
 *
 * 这里只做三件事：
 *   1. 把「角色 Agent 链」与「LLM Judge」两条路径的依赖关系翻译成 Promise 依赖图；
 *   2. 把流式增量转成回调，让 UI 能在生成过程中就渲染；
 *   3. 为每一轮记录可观测指标（TTFT / 总耗时 / 分片数 / 乱序分片数）。
 *
 * 不做的事：不碰 React，不写 localStorage，不做任何展示决策。
 */
import { Message, JudgeResult, Difficulty, NPCPersonality, JudgeEntry } from "../types";
import { getAdapter, resetAdapter } from "./llm";
import type { CallMetrics } from "./llm";
import { parseJsonLoose } from "./stream";
import {
  NPC_PROFILES,
  buildNpcPersonalities,
  buildNPCPrompt,
  buildStartPrompt,
  buildJudgePrompt,
  buildRecapPrompt,
  TOPICS_PROMPT,
} from "./prompts";

export { resetAdapter, toUserMessage, MissingKeyError } from "./llm";
export type { CallMetrics } from "./llm";

/** 单条消息的耗时指标 */
export interface StreamMetrics extends CallMetrics {
  /** 在整轮里，这条消息从本轮开始到首字出现的耗时 —— 玩家真正感知的等待 */
  visibleInMs: number;
}

/** 一轮对话的可观测数据 */
export interface TurnMetrics {
  turnId: string;
  /** 玩家点发送到第一个字出现在屏幕上的耗时 */
  ttftMs: number;
  /** 这一轮全部内容落地的耗时 */
  totalMs: number;
  /** Judge 与 Agent 链的实际重叠时间，用于验证并发调度是否生效 */
  overlapMs: number;
  judgeMs: number;
  npcChainMs: number;
  outOfOrderChunks: number;
}

/** 一轮的执行计划：两条路径同时启动，各自可增量消费 */
export interface TurnPlan {
  turnId: string;
  npcs: NPCPersonality[];
  /** Judge 结果。与 NPC 链并行推进 */
  judge: Promise<JudgeResult>;
  /** 第 i 条 NPC 回复。链内串行（每条依赖上一条），链间与 judge 并行 */
  npcReplies: Promise<StreamMetrics & { npcId: string; content: string }>[];
  /** 全部结束后的指标汇总 */
  metrics: Promise<TurnMetrics>;
  /** 取消整轮（组件卸载 / 玩家重开） */
  abort: () => void;
}

export interface NpcStreamHandlers {
  onDelta: (delta: string) => void;
}

// ══════════════════════════════════════════
// 基础调用
// ══════════════════════════════════════════

export { buildNpcPersonalities as generateNPCPersonalities };

/** 取 JSON 结果，解析失败重试一次 */
async function completeJson<T>(prompt: string, signal?: AbortSignal): Promise<T> {
  const adapter = await getAdapter();
  const first = await adapter.complete(prompt, { json: true, signal });
  const parsed = parseJsonLoose(first.text);
  if (parsed) return parsed as T;

  const retry = await adapter.complete(
    `${prompt}\n\n上一次返回的不是合法 JSON。RETURN ONLY VALID JSON.`,
    { json: true, signal },
  );
  const reparsed = parseJsonLoose(retry.text);
  if (!reparsed) throw new Error("模型连续两次未返回合法 JSON");
  return reparsed as T;
}

// ══════════════════════════════════════════
// 开场 / 话题 / 复盘
// ══════════════════════════════════════════

export async function generateGameStart(difficulty: Difficulty, customTheme?: string) {
  const npcs = buildNpcPersonalities();
  const data = await completeJson<{
    field: string;
    topic: string;
    initialExperts: { author: string; content: string }[];
    npcNames?: { id: string; name: string; title: string }[];
  }>(buildStartPrompt(difficulty, npcs, customTheme));

  const fullNpcs = npcs.map(npc => {
    const aiName = data.npcNames?.find(n => n.id === npc.id);
    return aiName ? { ...npc, name: aiName.name, title: aiName.title } : npc;
  });

  return {
    field: data.field,
    topic: data.topic,
    initialExperts: data.initialExperts || [],
    npcs: fullNpcs,
  };
}

const FALLBACK_TOPICS = [
  { name: '当代艺术评论', icon: '🎨', topics: ['为什么我看不懂当代艺术', '一张白纸卖100万合理吗'] },
  { name: '都市玄学', icon: '🔮', topics: ['星座到底准不准', '为什么总感觉有人在看你'] },
  { name: '时尚圈', icon: '👔', topics: ['为什么越丑的鞋越贵', '复古风到底在复什么古'] },
  { name: '恋爱心理学宗师局', icon: '💕', topics: ['为什么越主动越不被珍惜', '外表到底重不重要'] },
  { name: 'AI意识', icon: '🤖', topics: ['AI会有自我意识吗', '被AI取代是我的福报吗'] },
  { name: '未来学家圆桌会议', icon: '🔭', topics: ['人类什么时候能永生', '元宇宙死了吗'] },
];

export async function generateTopics(): Promise<{ name: string; icon: string; topics: string[] }[]> {
  try {
    const data = await completeJson<{ categories: { name: string; icon: string; topics: string[] }[] }>(TOPICS_PROMPT);
    return data.categories?.length ? data.categories : FALLBACK_TOPICS;
  } catch {
    return FALLBACK_TOPICS;
  }
}

export async function generateGameRecap(
  field: string,
  topic: string,
  rounds: number,
  finalSuspicion: number,
  messages: Message[],
  npcs: NPCPersonality[],
  judgeHistory: JudgeEntry[],
  signal?: AbortSignal,
): Promise<string> {
  const fallback = `在 ${field} 存活 ${rounds} 轮，最终怀疑度 ${finalSuspicion}%。`;
  try {
    const adapter = await getAdapter();
    const result = await adapter.complete(
      buildRecapPrompt({ field, topic, rounds, finalSuspicion, messages, npcs, judgeHistory }),
      { signal },
    );
    return result.text || fallback;
  } catch {
    return fallback;
  }
}

// ══════════════════════════════════════════
// 角色 Agent 链
// ══════════════════════════════════════════

/**
 * 生成单个 NPC 的回复（流式）。
 * 链内串行依赖 `prevContent`：第 i 个 NPC 要能接上第 i-1 个的话。
 * 这个依赖是产品语义，不是实现偷懒 —— 群聊里后发言的人本来就听过前面的。
 */
async function streamNpcReply(params: {
  npc: NPCPersonality;
  topic: string;
  round: number;
  playerMsg: string;
  prevContent: string | null;
  history: Message[];
  difficulty: Difficulty;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  onFirstToken?: () => void;
}): Promise<{ content: string; metrics: CallMetrics }> {
  const adapter = await getAdapter();
  const recentHistory = params.history
    .slice(-12)
    .map(m => `${m.author}: ${m.content}`)
    .join('\n');

  const prompt = buildNPCPrompt(
    params.npc,
    params.topic,
    params.round,
    params.playerMsg,
    params.prevContent,
    recentHistory,
    params.difficulty,
  );

  const result = await adapter.stream(prompt, {
    signal: params.signal,
    onFirstToken: params.onFirstToken,
    onDelta: params.onDelta,
  });

  return { content: result.text.trim() || '...', metrics: result.metrics };
}

// ══════════════════════════════════════════
// LLM Judge
// ══════════════════════════════════════════

export async function judgeRound(params: {
  playerMsg: string;
  npcDialogue: { npcId: string; content: string }[];
  npcs: NPCPersonality[];
  playerHistory: string;
  currentSuspicion: number;
  round: number;
  difficulty: Difficulty;
  signal?: AbortSignal;
}): Promise<JudgeResult> {
  return (await judgeRoundWithMetrics(params)).result;
}

/** 带指标的 Judge —— 用于验证「Judge 与 Agent 链重叠」是否真的发生 */
export async function judgeRoundWithMetrics(params: {
  playerMsg: string;
  npcDialogue: { npcId: string; content: string }[];
  npcs: NPCPersonality[];
  playerHistory: string;
  currentSuspicion: number;
  round: number;
  difficulty: Difficulty;
  signal?: AbortSignal;
}): Promise<{ result: JudgeResult; metrics: CallMetrics }> {
  const adapter = await getAdapter();
  const prompt = buildJudgePrompt(params);

  const attempt = async (text: string) => {
    const parsed = parseJsonLoose(text);
    // 分数缺失时补默认值，避免下游拿到 undefined 崩在计算里
    if (parsed && typeof parsed.feedback === 'string') return parsed as JudgeResult;
    return null;
  };

  const first = await adapter.complete(prompt, { json: true, signal: params.signal });
  const ok = await attempt(first.text);
  if (ok) return { result: ok, metrics: first.metrics };

  const retry = await adapter.complete(
    `${prompt}\n\n上一次返回的不是合法 JSON。RETURN ONLY VALID JSON.`,
    { json: true, signal: params.signal },
  );
  const second = await attempt(retry.text);
  if (second) return { result: second, metrics: retry.metrics };

  // 两次都不合法：给一个中性判定而不是让整轮崩掉
  return {
    result: {
      feedback: '这一轮没看清楚。',
      surrender: false,
      breakdown: { belonging: 5, consistency: 5, presence: 5, bonus: 0 },
    },
    metrics: retry.metrics,
  };
}

// ══════════════════════════════════════════
// 并发调度：一轮 = Judge ∥ NPC 链
// ══════════════════════════════════════════

export interface TurnInput {
  /** 本轮玩家发言 */
  playerMsg: string;
  /** 到本轮为止的完整消息记录（含玩家本轮发言） */
  fullHistory: Message[];
  /** 上一轮 NPC 的发言，供 Judge 参照 */
  prevNpcDialogue: { npcId: string; content: string }[];
  npcs: NPCPersonality[];
  topic: string;
  round: number;
  suspicion: number;
  difficulty: Difficulty;
  /** 第 i 条 NPC 的流式回调 */
  onNpcDelta?: (index: number, npcId: string, delta: string) => void;
  /** 第 i 条 NPC 首字到达时触发（TTFT 埋点） */
  onNpcFirstToken?: (index: number, npcId: string) => void;
  /** Judge 完成时触发 */
  onJudge?: (result: JudgeResult, metrics: CallMetrics) => void;
}

/**
 * 启动一轮。
 *
 * 调度形状：
 *      ┌── judge ────────────────────────┐
 *   t0 ┤                                  ├─→ 二者各自落地
 *      └── npc0 → npc1 → npc2 → npc3 ─────┘
 *
 * Judge 与 NPC 链之间无数据依赖（Judge 参照的是上一轮 NPC 发言），
 * 因此从第一轮起就完全重叠：整轮墙钟时间 ≈ max(judge, npc 链)，
 * 而不是两者之和。
 */
export function startTurn(input: TurnInput): TurnPlan {
  const turnId = `turn-${Date.now()}`;
  const startedAt = performance.now();
  const controller = new AbortController();
  const signal = controller.signal;

  let judgeEndedAt = 0;
  let npcChainEndedAt = 0;
  let npcChainStartedAt = 0;
  let ttftMs = -1;
  let outOfOrderChunks = 0;

  const markFirstToken = () => {
    if (ttftMs < 0) ttftMs = performance.now() - startedAt;
  };

  // ── 路径 A：Judge ──
  const judgeStartedAt = performance.now();
  const judge = judgeRoundWithMetrics({
    playerMsg: input.playerMsg,
    npcDialogue: input.prevNpcDialogue,
    npcs: input.npcs,
    playerHistory: input.fullHistory
      .filter(m => m.role === 'player')
      .slice(-5)
      .map(m => m.content)
      .join('\n---\n'),
    currentSuspicion: input.suspicion,
    round: input.round,
    difficulty: input.difficulty,
    signal,
  }).then(({ result, metrics }) => {
    judgeEndedAt = performance.now();
    input.onJudge?.(result, metrics);
    return result;
  });

  // ── 路径 B：NPC 链（链内串行，链与 judge 并行）──
  const chain: NPCPersonality[] = shuffle(input.npcs).slice(0, 4);
  npcChainStartedAt = performance.now();

  let prevContentPromise: Promise<string | null> = Promise.resolve(null);
  const npcReplies = chain.map((npc, index) => {
    // 首字可见时刻：玩家真正感知到的这条消息的等待时间
    let firstTokenAt = -1;
    const step = prevContentPromise.then(async prevContent => {
      const { content, metrics } = await streamNpcReply({
        npc,
        topic: input.topic,
        round: input.round,
        playerMsg: input.playerMsg,
        prevContent,
        history: input.fullHistory,
        difficulty: input.difficulty,
        signal,
        onDelta: delta => {
          markFirstToken();
          input.onNpcDelta?.(index, npc.id, delta);
        },
        onFirstToken: () => {
          firstTokenAt = performance.now();
          input.onNpcFirstToken?.(index, npc.id);
        },
      });
      outOfOrderChunks += metrics.outOfOrderChunks;
      return {
        npcId: npc.id,
        content,
        ...metrics,
        visibleInMs: (firstTokenAt < 0 ? performance.now() : firstTokenAt) - startedAt,
      };
    });
    prevContentPromise = step.then(r => r.content).catch(() => null);
    return step;
  });

  const chainSettled = Promise.allSettled(npcReplies).then(() => {
    npcChainEndedAt = performance.now();
  });

  const metrics: Promise<TurnMetrics> = Promise.all([judge, chainSettled]).then(() => ({
    turnId,
    ttftMs: ttftMs < 0 ? performance.now() - startedAt : ttftMs,
    totalMs: performance.now() - startedAt,
    // 两条路径都在运行的时间 = 并集减去各自的独占段
    overlapMs: Math.max(
      0,
      Math.min(judgeEndedAt, npcChainEndedAt) - Math.max(judgeStartedAt, npcChainStartedAt),
    ),
    judgeMs: judgeEndedAt - judgeStartedAt,
    npcChainMs: npcChainEndedAt - npcChainStartedAt,
    outOfOrderChunks,
  }));

  return {
    turnId,
    npcs: chain,
    judge,
    npcReplies,
    metrics,
    abort: () => controller.abort(),
  };
}

/** NPC 人格在链路中的原始原型名，用于调试面板 */
export function profileNameOf(npcId: string): string {
  const index = Number.parseInt(npcId.split('_')[1] || '0', 10);
  return NPC_PROFILES[index % NPC_PROFILES.length]?.name || npcId;
}

/**
 * 无偏洗牌（Fisher-Yates）。
 *
 * 不要用 `[...arr].sort(() => Math.random() - 0.5)`：比较器不一致会破坏
 * 排序算法的不变量，产出分布严重不均。实测 4 元素场景卡方值 275869
 * （自由度 23 的临界值仅 35.17），最频繁排列约为最稀有排列的 12 倍。
 * 见 tests/shuffle.test.ts 的差分测试。
 *
 * @param random 可注入的随机源，便于测试复现
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
