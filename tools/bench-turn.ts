#!/usr/bin/env node
/**
 * 一轮耗时的并发收益基线。
 *
 * 目的：把「优化 Multi-Agent 执行流水线，降低端到端延迟」从定性描述
 * 变成可复现的数字。
 *
 * 方法：在**完全可控**的条件下对比两种调度形状 ——
 *   A. 串行基线：先跑完 Judge，再跑 NPC 链（重构前的行为）
 *   B. 并发实现：startTurn()，Judge 与 NPC 链全程重叠
 *
 * 为什么必须用注入式假适配器：只有延迟完全可控，才能把
 * 「调度形状带来的差异」与「网络/模型抖动」分离开。
 * 用真实 API 测出来的数字无法归因到调度本身。
 *
 * 运行：npm run bench:turn
 */
import { startTurn, __setAdapterForTest } from '../src/services/ai';
import type { LLMAdapter, LLMConfig } from '../src/services/llm';
import type { NPCPersonality, Message } from '../src/types';

const CONFIG: LLMConfig = {
  apiKey: 'sk-bench',
  baseURL: 'https://mock',
  model: 'mock',
  timeoutMs: 60_000,
  idleMs: 60_000,
};

/** 模拟一次「模型推理」的耗时 */
const JUDGE_MS = 1_200;   // Judge 是一次较长的 JSON 生成
const NPC_MS = 900;       // 每个 NPC 的流式生成
const NPC_COUNT = 4;
const ROUNDS = 5;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const NPCS: NPCPersonality[] = Array.from({ length: NPC_COUNT }, (_, i) => ({
  id: `npc_${i}`,
  name: `NPC${i}`,
  title: '研究员',
  trait: '测试人格',
  avatar: i,
}));

const HISTORY: Message[] = [
  { id: 'm1', role: 'expert', author: 'NPC0', content: '开场', timestamp: new Date(), npcId: 'npc_0' },
];

function makeAdapter(): LLMAdapter {
  const judgeText = JSON.stringify({
    feedback: '本轮表现中性。',
    surrender: false,
    breakdown: { belonging: 5, consistency: 5, presence: 5, bonus: 0 },
  });

  return {
    config: CONFIG,
    client: {} as LLMAdapter['client'],
    complete: async () => {
      await sleep(JUDGE_MS);
      return {
        text: judgeText,
        metrics: { ttftMs: JUDGE_MS, totalMs: JUDGE_MS, chunks: 1, chars: judgeText.length, outOfOrderChunks: 0, model: 'bench' },
      };
    },
    stream: async (_prompt, cb) => {
      const text = '这是一条用于基准测试的固定长度NPC发言内容，约三十字。';
      const per = Math.floor(NPC_MS / text.length);
      for (const ch of text) {
        await sleep(per);
        cb.onDelta(ch);
      }
      return {
        text,
        metrics: { ttftMs: per, totalMs: NPC_MS, chunks: text.length, chars: text.length, outOfOrderChunks: 0, model: 'bench' },
      };
    },
  };
}

function baseInput(round: number) {
  return {
    playerMsg: '玩家发言',
    fullHistory: HISTORY,
    prevNpcDialogue: [{ npcId: 'npc_0', content: '上一轮发言' }],
    npcs: NPCS,
    topic: '基准测试',
    round,
    suspicion: 20,
    difficulty: 'medium' as const,
  };
}

/** A. 串行基线：Judge 跑完才开始 NPC 链（重构前的形状） */
async function serialTurn(): Promise<number> {
  const adapter = makeAdapter();
  const started = performance.now();

  // 1) 先 Judge
  await adapter.complete('judge');

  // 2) 再 NPC 链（链内串行）
  let prev = '';
  for (let i = 0; i < NPC_COUNT; i++) {
    const r = await adapter.stream('npc', { onDelta: () => {} });
    prev = r.text;
  }
  void prev;

  return performance.now() - started;
}

/** B. 并发实现：startTurn */
async function concurrentTurn(round: number): Promise<{ wall: number; overlap: number }> {
  __setAdapterForTest(makeAdapter());
  const started = performance.now();
  const turn = startTurn(baseInput(round));
  await Promise.all([turn.judge, ...turn.npcReplies.map(p => p.catch(() => null))]);
  const m = await turn.metrics;
  return { wall: performance.now() - started, overlap: m.overlapMs };
}

function stats(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function main() {
  console.log('════════ 一轮耗时基线 ════════');
  console.log(`条件（完全可控，无网络抖动）:`);
  console.log(`  Judge 单次      : ${JUDGE_MS}ms`);
  console.log(`  NPC 单个        : ${NPC_MS}ms × ${NPC_COUNT} 个（链内串行）`);
  console.log(`  每轮样本数      : ${ROUNDS}`);
  console.log('');
  console.log(`理论预期:`);
  console.log(`  串行 = Judge + NPC链 = ${JUDGE_MS} + ${NPC_MS * NPC_COUNT} = ${JUDGE_MS + NPC_MS * NPC_COUNT}ms`);
  console.log(`  并发 = max(Judge, NPC链) = max(${JUDGE_MS}, ${NPC_MS * NPC_COUNT}) = ${Math.max(JUDGE_MS, NPC_MS * NPC_COUNT)}ms`);
  console.log('');

  __setAdapterForTest(null);

  // ── A. 串行 ──
  const serialWalls: number[] = [];
  for (let i = 0; i < ROUNDS; i++) serialWalls.push(await serialTurn());

  // ── B. 并发 ──
  const concurrentWalls: number[] = [];
  const overlaps: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const r = await concurrentTurn(i + 1);
    concurrentWalls.push(r.wall);
    overlaps.push(r.overlap);
  }

  __setAdapterForTest(null);

  const s = stats(serialWalls);
  const c = stats(concurrentWalls);

  const fmt = (n: number) => `${Math.round(n)}ms`;
  console.log('── 实测墙钟 ──');
  console.log(`                  mean      p50       p95`);
  console.log(`  串行（基线）    ${fmt(s.mean).padEnd(9)} ${fmt(s.p50).padEnd(9)} ${fmt(s.p95)}`);
  console.log(`  并发（实现）    ${fmt(c.mean).padEnd(9)} ${fmt(c.p50).padEnd(9)} ${fmt(c.p95)}`);
  console.log('');
  console.log(`  降幅（mean）    ${(100 * (1 - c.mean / s.mean)).toFixed(1)}%`);
  console.log(`  降幅（p95）     ${(100 * (1 - c.p95 / s.p95)).toFixed(1)}%`);
  console.log(`  观测到的重叠    mean ${fmt(stats(overlaps).mean)}`);
  console.log('');
  console.log(`注：这是**调度形状**带来的收益，与网络延迟和模型速度无关。`);
  console.log(`    真实环境下的绝对耗时取决于模型速度，但「串行 sum → 并发 max」`);
  console.log(`    这个结构性的比例关系不变。`);
}

main().catch(e => { console.error(e); process.exit(1); });
