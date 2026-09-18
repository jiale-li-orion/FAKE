import type { Page, Route, Request } from '@playwright/test';

/**
 * Mock LLM —— 拦截浏览器对 DeepSeek 的真实请求。
 *
 * 为什么要 mock：
 *   前端**不经过自己的 Express**，而是由浏览器直接用 openai SDK 请求
 *   https://api.deepseek.com/chat/completions。所以 E2E 必须在这一层拦截，
 *   否则用例既需要真 Key、又不确定、还会烧钱。
 *
 * 拦截点：chat/completions 路径（用 glob 匹配，不写死域名，
 *   这样即使以后换 baseURL 也不会静默失效）。
 */

// ══════════════════════════════════════════
// 控制面
// ══════════════════════════════════════════

/** Judge 返回的分数。数值越高 = 玩家越像外人 = 怀疑度涨得越快 */
export interface JudgeBreakdown {
  belonging: number;
  consistency: number;
  presence: number;
  bonus: number;
}

/** NPC 流式行为 */
export interface StreamBehavior {
  /**
   * 'normal'  正常下发所有 chunk 并以 finish_reason 收尾
   * 'stall'   下发若干 chunk 后**永久沉默**（连接保持打开，不发 [DONE]）
   *           —— 用于验证客户端超时保护
   * 'abrupt'  下发若干 chunk 后直接结束响应，不发 finish_reason
   * 'reorder' 故意把 chunk 顺序打乱下发，验证消费顺序守卫
   */
  mode?: 'normal' | 'stall' | 'abrupt' | 'reorder';
  /** 每个 chunk 之间插入的人工延迟（ms）。默认 0 */
  delayMs?: number;
  /** stall / abrupt 模式下，沉默前先下发多少个 chunk。默认 2 */
  chunksBeforeStop?: number;
  /** 一轮里每个 NPC 的回复正文，按出场顺序取 */
  replies?: string[];
}

export interface MockLlmControl {
  /** 第几次 judge 调用 —— 用于按轮次改变评分 */
  judgeCall: number;
  /** 根据轮次算出本轮 breakdown，默认恒定值 */
  judgeBreakdown: (judgeCall: number) => JudgeBreakdown;
  judgeFeedback: string;
  judgeSceneType: string;
  /** surrender=true 会立刻结束游戏 */
  judgeSurrender: boolean;
  /** 开局数据 */
  start: {
    field: string;
    topic: string;
    npcNames: { id: string; name: string; title: string }[];
    initialExperts: { author: string; content: string }[];
  };
  topics: { name: string; icon: string; topics: string[] }[];
  /** 复盘正文（纯文本，不能用 markdown 符号） */
  recap: string;
  stream: StreamBehavior;
  /** 每个被拦截的请求都会记一笔，便于断言"到底发了几个请求" */
  calls: RecordedCall[];
}

export interface RecordedCall {
  kind: 'probe' | 'topics' | 'start' | 'judge' | 'npc' | 'recap' | 'unknown';
  stream: boolean;
  json: boolean;
  /** 从 prompt 里抽出的 NPC 原型名（仅 npc 请求有值） */
  npcPrototype?: string;
}

const NAMES = ['林之远', 'Kaya Novak', '周慕白', 'Émile Rousseau'];

const DEFAULT_REPLIES = [
  '（摸了摸下巴）这个说法有点意思，不过我印象里业界不是这么干的。',
  '样本量是多少？我总觉得这个结论下得有点急。',
  '你角度很新啊，但是你忽略了一个基本前提。',
  '坏了，虽然没听懂但感觉你说得对。',
];

export function createMockState(): MockLlmControl {
  return {
    judgeCall: 0,
    // 默认给一个「不致命」的分数，让游戏能持续推进多轮
    judgeBreakdown: () => ({ belonging: 3, consistency: 3, presence: 3, bonus: 0 }),
    judgeFeedback: '这一轮你混得还行。',
    judgeSceneType: '日常吹水',
    judgeSurrender: false,
    start: {
      field: '当代艺术评论',
      topic: '为什么我看不懂当代艺术',
      npcNames: [
        { id: 'npc_0', name: NAMES[0], title: '策展人' },
        { id: 'npc_1', name: NAMES[1], title: '研究员' },
        { id: 'npc_2', name: NAMES[2], title: '评论家' },
        { id: 'npc_3', name: NAMES[3], title: '收藏家' },
      ],
      initialExperts: [
        { author: NAMES[0], content: '（敲了敲桌子）昨天那个展你们去了吗，我是真没看懂。' },
        { author: NAMES[1], content: '去了，出来之后我一句话都说不出来。' },
        { author: NAMES[2], content: '（喝了口茶慢慢打字）看不懂恰恰是它的意图之一。' },
        { author: NAMES[3], content: '反正我买的那幅涨了，别的我不关心。' },
      ],
    },
    topics: [
      { name: '当代艺术评论', icon: '🎨', topics: ['为什么我看不懂当代艺术', '一张白纸卖100万合理吗'] },
      { name: '都市玄学', icon: '🔮', topics: ['星座到底准不准', '为什么总感觉有人在看你'] },
      { name: '时尚圈', icon: '👔', topics: ['为什么越丑的鞋越贵', '复古风到底在复什么古'] },
      { name: '恋爱心理学宗师局', icon: '💕', topics: ['为什么越主动越不被珍惜', '外表到底重不重要'] },
      { name: 'AI意识', icon: '🤖', topics: ['AI会有自我意识吗', '被AI取代是我的福报吗'] },
      { name: '未来学家圆桌会议', icon: '🔭', topics: ['人类什么时候能永生', '元宇宙死了吗'] },
    ],
    recap: [
      '🎭 身份构造模式',
      '你靠不断抛出新角度来维持在场感，证据是"我觉得这个问题的关键在于"。',
      '',
      '⚠️ 身份崩解报告',
      '你的术语密度远高于群里任何人，这在第三轮之后开始显眼。',
      '',
      '🤖 AI锐评',
      '你说得越多，越像一个刚读完摘要的人。',
      '',
      '🏅 称号系统',
      '「半瓶水战神」—— 你总能用正确的词说出错误的判断。',
    ].join('\n'),
    stream: {},
    calls: [],
  };
}

// ══════════════════════════════════════════
// 请求分发
// ══════════════════════════════════════════

interface ParsedBody {
  stream: boolean;
  json: boolean;
  prompt: string;
  npcPrototype?: string;
}

/** 从 prompt 反推是哪个 NPC 在说话 —— 靠人格描述里的独有词 */
function detectNpcPrototype(prompt: string): string | undefined {
  if (!prompt.includes('## 你的角色')) return undefined;
  if (prompt.includes('术语狂')) return '术语轰炸机';
  if (prompt.includes('漏洞有病态嗅觉')) return '逻辑狙击手';
  if (prompt.includes('糖衣炮弹')) return '捧杀艺术家';
  if (prompt.includes('乐子人')) return '乐子人';
  return '未知人格';
}

function parseBody(raw: string): ParsedBody {
  let body: any = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return { stream: false, json: false, prompt: '' };
  }
  const prompt: string =
    body?.messages?.map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n') || '';
  return {
    stream: body?.stream === true,
    json: body?.response_format?.type === 'json_object',
    prompt,
    npcPrototype: detectNpcPrototype(prompt),
  };
}

function classify(parsed: ParsedBody, raw: string): RecordedCall['kind'] {
  // 连通性探测：max_tokens=1 的短请求
  if (/"max_tokens"\s*:\s*1\b/.test(raw)) return 'probe';
  if (parsed.prompt.includes('生成12个有趣的闲聊话题')) return 'topics';
  if (parsed.prompt.includes('你是"Fake"游戏的评审')) return 'judge';
  if (parsed.prompt.includes('写一份极简复盘报告')) return 'recap';
  if (parsed.prompt.includes('你生成一个论坛闲聊场景')) return 'start';
  if (parsed.npcPrototype) return 'npc';
  return 'unknown';
}

// ══════════════════════════════════════════
// 响应构造
// ══════════════════════════════════════════

/** 非流式 / 流式的「完整消息」外壳 */
function completionShell(content: string, stream: boolean) {
  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'deepseek-mock',
    choices: [
      stream
        ? { index: 0, delta: { role: 'assistant', content }, finish_reason: null }
        : { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
    ],
  };
}

function jsonResponse(content: string) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(completionShell(content, false)),
  };
}

/** 把正文切成 chunk —— 刻意切得碎，才能观察到逐字增长 */
function splitIntoChunks(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 2) out.push(text.slice(i, i + 2));
  return out.length ? out : [''];
}

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

interface SsePlan {
  head: string;
  tail: string;
  delayMs: number;
}

/**
 * 构造 SSE 响应体。
 *
 * 真实 SSE 格式：每个事件是 `data: {...}\n\n`，最后以 `data: [DONE]\n\n` 收尾。
 * stall 模式刻意**不发 tail**，且响应体到此为止但连接不关闭 ——
 * 这正是我们要复现的「供应商中途沉默」。
 */
function buildSse(text: string, behavior: StreamBehavior): SsePlan {
  const mode = behavior.mode || 'normal';
  const delayMs = behavior.delayMs ?? 0;
  let chunks = splitIntoChunks(text);

  if (mode === 'reorder' && chunks.length >= 3) {
    // 把第 2、3 个 chunk 对调，制造乱序
    chunks = [chunks[0], chunks[2], chunks[1], ...chunks.slice(3)];
  }
  if ((mode === 'stall' || mode === 'abrupt') && behavior.chunksBeforeStop != null) {
    chunks = chunks.slice(0, behavior.chunksBeforeStop);
  }

  const head = chunks.map(c => sseFrame(completionShell(c, true))).join('');

  if (mode === 'stall' || mode === 'abrupt') {
    // 没有 finish_reason，也没有 [DONE]
    return { head, tail: '', delayMs };
  }

  const finish = sseFrame({
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'deepseek-mock',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });

  return { head, tail: `${finish}data: [DONE]\n\n`, delayMs };
}

/** 带延迟地吐出响应体，然后 hold 住连接（不主动结束） */
async function sendStreaming(route: Route, plan: SsePlan): Promise<void> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const parts = plan.delayMs > 0 ? plan.head.match(/data: [^\n]*\n\n/g) || [plan.head] : [plan.head];
      try {
        for (const part of parts) {
          controller.enqueue(enc.encode(part));
          if (plan.delayMs > 0) await new Promise(r => setTimeout(r, plan.delayMs));
        }
        if (plan.tail) controller.enqueue(enc.encode(plan.tail));
      } catch {
        /* 客户端断开时会走到这里，属正常 */
      }
      // 刻意不 close()：让 Playwright 保持连接打开。
      // normal 模式下由下方的 route.fulfill 语义收尾，stall 模式下这就是「永久沉默」。
    },
  });

  await route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
    body: stream as any,
  });
}

// ══════════════════════════════════════════
// 安装
// ══════════════════════════════════════════

export interface MockLlm {
  state: MockLlmControl;
  /** 某类请求被调用了几次 */
  countOf(kind: RecordedCall['kind']): number;
  /** 该 NPC 原型被生成了几次 */
  countNpc(prototype: string): number;
}

/**
 * 安装 mock 路由。返回控制句柄。
 *
 * 用法：
 *   const llm = await installMockLlm(page);
 *   llm.state.judgeBreakdown = () => ({ belonging: 10, ... });  // 让玩家快速失败
 */
export async function installMockLlm(page: Page, overrides: Partial<MockLlmControl> = {}): Promise<MockLlm> {
  const state: MockLlmControl = { ...createMockState(), ...overrides };
  if (overrides.stream) state.stream = { ...overrides.stream };
  if (overrides.start) state.start = { ...overrides.start };

  let npcServed = 0;

  await page.route('**/chat/completions', async (route: Route, request: Request) => {
    const raw = request.postData() || '';
    const parsed = parseBody(raw);
    const kind = classify(parsed, raw);
    state.calls.push({ kind, stream: parsed.stream, json: parsed.json, npcPrototype: parsed.npcPrototype });

    // ── 连通性探测 → 极简补全 ──
    if (kind === 'probe') {
      await route.fulfill(jsonResponse('pong'));
      return;
    }

    // ── 话题池 ──
    if (kind === 'topics') {
      await route.fulfill(jsonResponse(JSON.stringify({ categories: state.topics })));
      return;
    }

    // ── 开局 ──
    if (kind === 'start') {
      await route.fulfill(jsonResponse(JSON.stringify({
        npcNames: state.start.npcNames,
        field: state.start.field,
        topic: state.start.topic,
        initialExperts: state.start.initialExperts,
      })));
      return;
    }

    // ── Judge ──
    if (kind === 'judge') {
      const call = ++state.judgeCall;
      await route.fulfill(jsonResponse(JSON.stringify({
        feedback: state.judgeFeedback,
        surrender: state.judgeSurrender,
        breakdown: state.judgeBreakdown(call),
        sceneType: state.judgeSceneType,
      })));
      return;
    }

    // ── 复盘 ──
    if (kind === 'recap') {
      await route.fulfill(jsonResponse(state.recap));
      return;
    }

    // ── NPC 流式回复 ──
    if (kind === 'npc') {
      const replies = state.stream.replies || DEFAULT_REPLIES;
      const text = replies[npcServed % replies.length];
      npcServed += 1;
      await sendStreaming(route, buildSse(text, state.stream));
      return;
    }

    // 未知请求：给出可诊断的响应，而不是静默挂起
    state.calls.push({ kind: 'unknown', stream: parsed.stream, json: parsed.json });
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: `mock 未识别的请求：${raw.slice(0, 200)}` } }),
    });
  });

  return {
    state,
    countOf: kind => state.calls.filter(c => c.kind === kind).length,
    countNpc: proto => state.calls.filter(c => c.kind === 'npc' && c.npcPrototype === proto).length,
  };
}

// ══════════════════════════════════════════
// 页面级辅助
// ══════════════════════════════════════════

export const MOCK_KEY = 'sk-mock-e2e-key';

/**
 * 预置 API Key。
 *
 * 必须在页面脚本执行前注入 —— App 在 useState 初始化时就读 localStorage，
 * addInitScript 正好在这个时机之前跑。
 */
export async function seedApiKey(page: Page, key: string = MOCK_KEY): Promise<void> {
  await page.addInitScript(k => {
    window.localStorage.setItem('DEEPSEEK_API_KEY', k);
  }, key);
}

/** 走进一局游戏：进入论坛 → 自定义话题 → 简单难度 */
export async function startGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /进入论坛/ }).click();
  await page.getByPlaceholder('自己写一个话题...').fill('为什么我看不懂当代艺术');
  await page.getByRole('button', { name: /确认/ }).click();
  await page.getByRole('button', { name: /简单/ }).click();
  // 等到 4 条开场 NPC 消息全部出现
  await page.getByText('看不懂恰恰是它的意图之一。').waitFor({ timeout: 30_000 });
}

/** 游戏内输入框 */
export function gameInput(page: Page) {
  return page.getByPlaceholder(/参与关于 .* 的讨论/);
}

/** 发一句玩家发言 */
export async function sendPlayerMessage(page: Page, text: string): Promise<void> {
  const input = gameInput(page);
  await input.fill(text);
  await input.press('Enter');
}
