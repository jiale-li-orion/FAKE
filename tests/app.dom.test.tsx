/**
 * L4/L5 组件与渲染层测试。
 *
 * 这一层补的是简历第三条里唯一还没被测住的部分：
 *   「实现 Token/Chunk 级增量消费、流式状态更新与 React Incremental Rendering」
 *
 * 纯函数层（L1）和运行时层（L3）都已覆盖，但"增量是否真的渲染到 DOM"
 * 只能在组件层验证。核心断言是**中间态**：
 *   在整条回复生成完成之前，气泡就已经存在且文本在增长。
 *   若代码是"等全部生成完再一次性 setState"，这条断言必然失败。
 *
 * 另外锁住两条容易在重构中被破坏的状态契约：
 *   · 生成中的文本不写入 state.messages（否则半成品会被存档）
 *   · 回复完成后流式气泡消失、正式消息出现，且不重复
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../src/App';
import * as aiService from '../src/services/ai';
import type { CallMetrics, TurnMetrics } from '../src/services/ai';
import type { NPCPersonality, Message } from '../src/types';

// ══════════════════════════════════════════
// 可控的假运行时
// ══════════════════════════════════════════

const NPCS: NPCPersonality[] = [
  { id: 'npc_0', name: '甲', title: '研究员', trait: '术语轰炸机', avatar: 0 },
  { id: 'npc_1', name: '乙', title: '教授', trait: '逻辑狙击手', avatar: 1 },
  { id: 'npc_2', name: '丙', title: '编辑', trait: '捧杀艺术家', avatar: 2 },
  { id: 'npc_3', name: '丁', title: '博主', trait: '乐子人', avatar: 3 },
];

const METRICS: CallMetrics = {
  ttftMs: 10, totalMs: 100, chunks: 5, chars: 20, outOfOrderChunks: 0, model: 'mock',
};

/**
 * 捕获 startTurn 的回调，让测试完全掌控"增量何时到达"。
 * 这样断言不依赖真实计时，也就不会 flaky。
 */
interface TurnHarness {
  emitDelta: (index: number, npcId: string, delta: string) => void;
  finishNpc: (index: number) => void;
  resolveJudge: () => void;
  emitJudgePending: () => void;
}

let harness: TurnHarness;
let startTurnSpy: ReturnType<typeof vi.spyOn>;

/** 每个 NPC 的最终内容 */
const NPC_CONTENT = ['甲的回复内容', '乙的回复内容', '丙的回复内容', '丁的回复内容'];

function installFakeRuntime(opts: { judgeResult?: any } = {}) {
  startTurnSpy = vi.spyOn(aiService, 'startTurn').mockImplementation((input: any) => {
    // 真实 startTurn 会洗牌；测试里保持固定顺序，去掉不确定性
    const chain: NPCPersonality[] = NPCS.slice(0, 4);

    let resolveJudgeFn: (v: any) => void;
    const judge = new Promise<any>(res => { resolveJudgeFn = res; });

    const npcResolvers: ((v: any) => void)[] = [];
    const npcReplies = chain.map((npc, i) =>
      new Promise<any>(res => { npcResolvers[i] = res; })
    );

    const metricsPromise = new Promise<TurnMetrics>(res => {
      // 测试不关心指标，Judge 一解决就给个占位
      judge.then(() => res({
        turnId: 'turn-test', ttftMs: 10, totalMs: 100, overlapMs: 50,
        judgeMs: 100, npcChainMs: 200, outOfOrderChunks: 0,
        npcCount: 4, judgeSawNpcCount: 1,
      }));
    });

    harness = {
      emitDelta: (index, npcId, delta) => {
        act(() => { input.onNpcDelta?.(index, npcId, delta); });
      },
      finishNpc: (index) => {
        act(() => {
          npcResolvers[index]({
            npcId: chain[index].id,
            content: NPC_CONTENT[index],
            ...METRICS,
            visibleInMs: 10,
          });
        });
      },
      resolveJudge: () => {
        act(() => {
          resolveJudgeFn(opts.judgeResult ?? {
            feedback: '这一轮你没露馅。',
            surrender: false,
            breakdown: { belonging: 3, consistency: 3, presence: 4, bonus: -1 },
          });
        });
      },
      emitJudgePending: () => { /* onJudge 由 resolveJudge 触发 */ },
    };

    return {
      turnId: 'turn-test',
      npcs: chain,
      judge: judge.then(r => { input.onJudge?.(r, METRICS); return r; }),
      npcReplies,
      metrics: metricsPromise,
      abort: vi.fn(),
    } as any;
  });
}

/**
 * 让 App 停在"游戏中"状态。
 *
 * 实际流程（四步，缺一步都进不去）：
 *   首页 -进入论坛→ 话题选择（此时话题池为空，需先「加载话题池」）
 *        -选一个话题→ 难度选择 -点难度→ startGame → playing
 */
async function enterGame(user: ReturnType<typeof userEvent.setup>) {
  const [enterBtn] = await screen.findAllByRole('button', { name: /进入论坛/ });
  await user.click(enterBtn);

  // 话题池是惰性加载的：不点这个按钮，下面的分类不会渲染
  const loadTopics = await screen.findByRole('button', { name: /加载话题池/ }, { timeout: 5000 });
  await user.click(loadTopics);

  // 选一个话题 → 进入难度选择
  const topic = await screen.findByRole('button', { name: '话题甲' }, { timeout: 5000 });
  await user.click(topic);

  // 选难度 → 真正开局
  const difficulty = await screen.findByText('中等', {}, { timeout: 5000 });
  await user.click(difficulty);

  await screen.findByTestId('player-input', {}, { timeout: 10_000 });
}

beforeEach(() => {
  // 显式卸载上一个用例的组件树。RTL 的自动清理依赖 afterEach 注册，
  // 在 vitest 的 globals 之外不一定生效；不清理会让多个 App 实例
  // 同时留在 document 里，出现 "Found multiple elements" 之类的假失败。
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();

  // ── mock 掉服务层的开局与话题，只保留组件逻辑被真实执行 ──
  vi.spyOn(aiService, 'generateTopics').mockResolvedValue([
    { name: '当代艺术评论', icon: '🎨', topics: ['话题甲', '话题乙'] },
  ]);
  vi.spyOn(aiService, 'generateGameStart').mockResolvedValue({
    field: '当代艺术评论',
    topic: '为什么看不懂当代艺术',
    initialExperts: [
      { author: '甲', content: '开场闲聊一' },
      { author: '乙', content: '开场闲聊二' },
      { author: '丙', content: '开场闲聊三' },
      { author: '丁', content: '开场闲聊四' },
    ],
    npcs: NPCS,
  } as any);
  vi.spyOn(aiService, 'generateGameRecap').mockResolvedValue('复盘报告占位');

  installFakeRuntime();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════
describe('开局渲染', () => {
  it('开局后渲染出 4 条开场消息与输入框', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);

    await enterGame(user);

    await waitFor(() => {
      expect(screen.getAllByTestId('msg-npc').length).toBeGreaterThanOrEqual(4);
    });
    expect(screen.getByTestId('player-input')).toBeTruthy();
  });

  it('开局失败时给出明确错误提示并回到首页，而非白屏', async () => {
    const user = userEvent.setup();
    // 让开局调用失败。注意 generateGameStart 只在「点难度」那一步触发，
    // 因此必须走完话题/难度流程才能测到错误分支。
    (aiService.generateGameStart as any).mockRejectedValue(new Error('boom'));

    render(<App />);
    const [enterBtn] = await screen.findAllByRole('button', { name: /进入论坛/ });
    await user.click(enterBtn);
    await user.click(await screen.findByRole('button', { name: /加载话题池/ }));
    await user.click(await screen.findByRole('button', { name: '话题甲' }));
    await user.click(await screen.findByText('中等'));

    // 组件捕获错误、显示提示，并回到 idle（首页仍可交互）
    await waitFor(() => {
      expect(screen.getByText(/论坛进不去|API Key|失联/)).toBeTruthy();
    }, { timeout: 5000 });
    expect(await screen.findByRole('button', { name: /进入论坛/ })).toBeTruthy();
  });
});

// ══════════════════════════════════════════
describe('流式增量渲染（简历第三条的验收）', () => {
  it('整条回复完成之前，气泡已存在且文本随增量增长', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    await user.type(screen.getByTestId('player-input'), '我觉得关键在于叙事框架');
    await user.click(screen.getByTestId('send-button'));

    // 玩家消息立即上屏（不等任何人）
    await waitFor(() => {
      const players = screen.getAllByTestId('msg-player');
      expect(players.some(el => el.textContent?.includes('叙事框架'))).toBe(true);
    });

    // 第 0 个 NPC 吐出第一段增量 —— 此时整条链远未完成
    harness.emitDelta(0, 'npc_0', '甲说的');
    await waitFor(() => {
      expect(screen.getByTestId('streaming-text').textContent).toBe('甲说的');
    });

    // 再吐一段：文本必须增长，而不是等全部完成才出现
    harness.emitDelta(0, 'npc_0', '第一句话。');
    await waitFor(() => {
      expect(screen.getByTestId('streaming-text').textContent).toBe('甲说的第一句话。');
    });

    // 此时还没有任何 NPC 正式消息落地 —— 证明渲染的是"生成中"状态
    expect(screen.getAllByTestId('msg-npc').length).toBe(4); // 仅开场的 4 条
  });

  it('多个 NPC 并行生成时各自有独立气泡', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    await user.type(screen.getByTestId('player-input'), '发言');
    await user.click(screen.getByTestId('send-button'));

    harness.emitDelta(0, 'npc_0', '零号');
    harness.emitDelta(1, 'npc_1', '一号');

    await waitFor(() => {
      expect(screen.getAllByTestId('msg-streaming').length).toBe(2);
    });

    const bubbles = screen.getAllByTestId('streaming-text').map(el => el.textContent);
    expect(bubbles).toContain('零号');
    expect(bubbles).toContain('一号');
  });

  it('回复完成后：流式气泡消失，正式消息出现且内容一致', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    await user.type(screen.getByTestId('player-input'), '发言');
    await user.click(screen.getByTestId('send-button'));

    // 先流式一段
    harness.emitDelta(0, 'npc_0', '部分内容');
    await waitFor(() => expect(screen.getByTestId('streaming-text')).toBeTruthy());

    // Judge 结算（组件随后开始逐条 await npcReplies）
    harness.resolveJudge();
    // 第 0 条落地
    harness.finishNpc(0);

    await waitFor(() => {
      const npcBubbles = screen.getAllByTestId('msg-npc');
      expect(npcBubbles.some(el => el.textContent?.includes(NPC_CONTENT[0]))).toBe(true);
    });

    // 该 NPC 的流式气泡必须已消失（不能与正式消息并存，否则视觉重复）
    await waitFor(() => {
      const streaming = screen.queryAllByTestId('msg-streaming');
      const hasNpc0Streaming = streaming.some(el => el.getAttribute('data-npc-id') === 'npc_0');
      expect(hasNpc0Streaming).toBe(false);
    });
  });

  it('生成中的文本不写入 localStorage 存档', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    await user.type(screen.getByTestId('player-input'), '发言');
    await user.click(screen.getByTestId('send-button'));

    harness.emitDelta(0, 'npc_0', '半成品不该被存档');
    await waitFor(() => expect(screen.getByTestId('streaming-text')).toBeTruthy());

    const save = localStorage.getItem('fakeExpert_save');
    expect(save).toBeTruthy();
    // 存档里绝不能出现流式中间态文本
    expect(save!).not.toContain('半成品不该被存档');
  });
});

// ══════════════════════════════════════════
describe('交互状态契约', () => {
  it('提交后输入框清空，生成期间发送按钮禁用', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    const input = screen.getByTestId('player-input') as HTMLInputElement;
    const send = screen.getByTestId('send-button') as HTMLButtonElement;

    await user.type(input, '发言内容');
    expect(send.disabled).toBe(false);

    await user.click(send);

    await waitFor(() => expect(input.value).toBe(''));
    // 生成期间按钮禁用（isTyping 或 输入为空）
    expect(send.disabled).toBe(true);
  });

  it('空输入不能提交', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    const send = screen.getByTestId('send-button') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it('Judge 未返回时显示「评审正在观察」指示', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    await user.type(screen.getByTestId('player-input'), '发言');
    await user.click(screen.getByTestId('send-button'));

    // Judge 尚未解决
    await waitFor(() => expect(screen.getByTestId('judge-pending')).toBeTruthy());

    // Judge 解决后指示消失
    harness.resolveJudge();
    await waitFor(() => expect(screen.queryByTestId('judge-pending')).toBeNull());
  });
});

// ══════════════════════════════════════════
describe('投降路径（组件内分支，不经过 LLM）', () => {
  it('输入「我认输」直接进入结算，不调用 startTurn', async () => {
    const user = userEvent.setup();
    localStorage.setItem('DEEPSEEK_API_KEY', 'sk-test');
    render(<App />);
    await enterGame(user);

    await user.type(screen.getByTestId('player-input'), '我认输');
    await user.click(screen.getByTestId('send-button'));

    // 投降分支内有 600ms 的延时（让玩家消息先渲染完再切结算）
    await waitFor(() => {
      expect(screen.queryByTestId('player-input')).toBeNull();
    }, { timeout: 6000 });

    // 关键契约：投降是硬编码分支，不发起任何 LLM 轮次
    expect(startTurnSpy).not.toHaveBeenCalled();
  });
});
