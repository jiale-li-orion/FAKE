/**
 * SSE 传输层注入夹具。
 *
 * 为什么需要它：FAKE 的 LLM 调用走 openai SDK → fetch。要在离线环境测
 * 「网络抖动下的流式消费」，必须能把 fetch 换成一个可以精确编排分片
 * 时序的假实现。这个文件就是那个编排器。
 *
 * 支持注入的真实故障模式（对应面试里会被追问的边界）：
 *   - splitFrames     SSE 帧跨 reader chunk 边界被切断
 *   - reorder         分片乱序到达
 *   - duplicate       重复下发（模拟重连重放 / 服务端重试）
 *   - stallAfter      发 N 片后静默（模拟供应商挂起）
 *   - keepAlive       插入 `: ping` 注释帧
 *   - emptyDeltas     插入 usage-only 空 delta 帧
 *   - status          非 200 状态码（401/429/500…）
 *   - neverResolve    连响应头都不返回（模拟 TCP 建连后无响应）
 */

export interface StreamPlan {
  /** 逻辑分片内容（会按 chunkSize 再切分以构造帧边界切断） */
  chunks: string[];
  /** 每片之间的间隔，默认 1ms */
  delayMs?: number;
  /** 每个逻辑分片再切成几段下发，>1 会制造跨 chunk 的帧切断 */
  chunkSize?: number;
  /** 分片乱序模式：把第 i 片推迟到 i+window 片之后再发 */
  reorderWindow?: number;
  /** 重复下发每个分片的次数（含首次），>1 制造重复帧 */
  duplicate?: number;
  /** 发满 N 片后彻底静默 —— 用于验证空闲超时 */
  stallAfter?: number;
  /** 在片间插入 SSE 注释心跳帧 */
  keepAlive?: boolean;
  /** 在片间插入 usage-only 空 delta 帧 */
  emptyDeltas?: boolean;
  /** HTTP 状态码，非 200 时直接返回错误 */
  status?: number;
  /** 是否以 [DONE] 结束 */
  done?: boolean;
}

export interface NonStreamPlan {
  /** 完整的 JSON 文本（按 role/content 包装成非流式响应体） */
  content: string;
  status?: number;
}

/** 记录每一次被拦截的请求，供断言使用 */
export interface CapturedRequest {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
  stream: boolean;
  at: number;
}

export interface MockTransport {
  /** 传给 new OpenAI({ fetch }) */
  fetch: typeof fetch;
  /** 按顺序记录的所有请求 */
  requests: CapturedRequest[];
  /** 已消费的流式计划；用完后回落到最后一个 */
  pushStream(plan: StreamPlan): void;
  pushNonStream(plan: NonStreamPlan): void;
  /** 清空请求记录与计划队列 */
  reset(): void;
  /** 生成第 n 段的文本（用于断言文本完整性） */
  expectedText(index: number): string;
}

// ────────────────────────────────────────────
// SSE 帧编码
// ────────────────────────────────────────────

const sseEvent = (payload: unknown, id?: number) =>
  `${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(payload)}\n\n`;

/** OpenAI 兼容的流式分片体 */
const deltaChunk = (content: string, finish: string | null = null) => ({
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'mock-model',
  choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * 把 StreamPlan 展开成「按时间顺序下发的字节片段」列表。
 * 展开过程本身就是要测的逻辑：乱序、重复、切断都在这里被编排出来。
 */
function materialize(plan: StreamPlan): { bytes: string; gapBefore: number }[] {
  const {
    chunks,
    delayMs = 1,
    chunkSize = 1,
    reorderWindow = 0,
    duplicate = 1,
    stallAfter,
    keepAlive = false,
    emptyDeltas = false,
    done = true,
  } = plan;

  type Frame = { bytes: string; kind: 'content' };
  const frames: Frame[] = [];

  chunks.forEach((text, i) => {
    // 每个逻辑分片切成 chunkSize 段，制造 SSE 帧跨 reader chunk 的切断
    const pieces = chunkSize > 1 ? splitInto(text, chunkSize) : [text];
    pieces.forEach(piece => {
      for (let d = 0; d < duplicate; d++) {
        frames.push({ bytes: sseEvent(deltaChunk(piece)), kind: 'content' });
      }
    });

    if (keepAlive && i < chunks.length - 1) {
      frames.push({ bytes: `: keep-alive ${i}\n\n`, kind: 'content' });
    }
    if (emptyDeltas && i < chunks.length - 1) {
      frames.push({ bytes: sseEvent(deltaChunk('')), kind: 'content' });
    }
  });

  if (done) frames.push({ bytes: sseEvent(deltaChunk('', 'stop')), kind: 'content' });
  if (done) frames.push({ bytes: 'data: [DONE]\n\n', kind: 'content' });

  // 乱序：把第 i 个往后挪 reorderWindow 个位置
  let ordered = frames;
  if (reorderWindow > 0) {
    ordered = reorder(frames, reorderWindow);
  }

  // stall：截断后续所有帧
  const cut = stallAfter !== undefined ? stallAfter : ordered.length;
  // 注意：不要把回调参数命名为 bytes —— 它会遮蔽 Frame.bytes 字段
  return ordered.slice(0, cut).map(frame => ({ bytes: frame.bytes, gapBefore: delayMs }));
}

/** 把字符串平均切成 n 段（用于制造帧边界切断） */
function splitInto(text: string, n: number): string[] {
  if (n <= 1 || text.length <= 1) return [text];
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** 确定性乱序：交换相邻的成对元素（可复现，便于回归） */
function reorder<T>(items: T[], window: number): T[] {
  const out = [...items];
  for (let i = 0; i + window < out.length; i += window + 1) {
    const j = Math.min(i + window, out.length - 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ────────────────────────────────────────────
// 传输实现
// ────────────────────────────────────────────

export function createMockTransport(): MockTransport {
  const requests: CapturedRequest[] = [];
  const streamPlans: StreamPlan[] = [];
  const nonStreamPlans: NonStreamPlan[] = [];
  let streamCursor = 0;
  let nonStreamCursor = 0;

  const mockFetch = async (input: any, init: any = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const rawBody = typeof init.body === 'string' ? init.body : '';
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = { __unparsed: rawBody }; }

    const isStream = body?.stream === true;
    requests.push({
      url,
      method: init.method || 'GET',
      body,
      headers: normalizeHeaders(init.headers),
      stream: isStream,
      at: performance.now(),
    });

    if (isStream) {
      const plan = streamPlans[streamCursor] ?? streamPlans[streamCursor - 1] ?? { chunks: [''] };
      // 可重试的错误不推进游标：SDK 重试时应拿到同一个错误响应，
      // 否则重试会意外「成功」并返回兜底计划，把失败伪装成通过。
      if (!isRetryable(plan.status)) streamCursor += 1;
      return makeSseResponse(plan);
    }

    const plan = nonStreamPlans[nonStreamCursor] ?? nonStreamPlans[nonStreamCursor - 1] ?? { content: '{}' };
    if (!isRetryable(plan.status)) nonStreamCursor += 1;
    return makeJsonResponse(plan);
  };

  const expectedText = (index: number) => {
    const plan = streamPlans[index] ?? streamPlans[streamPlans.length - 1];
    if (!plan) return '';
    // 乱序不改内容，只改顺序；重复会引入重复内容，这里返回去重前的真实期望
    return plan.chunks.join('');
  };

  return {
    fetch: mockFetch as unknown as typeof fetch,
    requests,
    pushStream(plan) { streamPlans.push(plan); },
    pushNonStream(plan) { nonStreamPlans.push(plan); },
    reset() {
      requests.length = 0;
      streamPlans.length = 0;
      nonStreamPlans.length = 0;
      streamCursor = 0;
      nonStreamCursor = 0;
    },
    expectedText,
  };
}

/** SDK 会自动重试的状态码（见 openai/client.js shouldRetry） */
function isRetryable(status?: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
}

function normalizeHeaders(h: any): Record<string, string> {
  if (!h) return {};
  if (typeof Headers !== 'undefined' && h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...h };
}

function makeJsonResponse(plan: NonStreamPlan): Response {
  const status = plan.status ?? 200;
  if (status !== 200) {
    return new Response(JSON.stringify({ error: { message: `mock error ${status}`, type: 'mock' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const payload = {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 1,
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content: plan.content }, finish_reason: 'stop' }],
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * 构造一个 text/event-stream 响应。
 * 用 ReadableStream 逐段 enqueue（每段之间 sleep），
 * 以便真实复现「分片陆续到达」的时序。
 */
function makeSseResponse(plan: StreamPlan): Response {
  const status = plan.status ?? 200;
  if (status !== 200) {
    return new Response(JSON.stringify({ error: { message: `mock error ${status}`, type: 'mock' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const pieces = materialize(plan);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const piece of pieces) {
          if (piece.gapBefore > 0) await sleep(piece.gapBefore);
          controller.enqueue(encoder.encode(piece.bytes));
        }
        // stallAfter 已由 materialize 截断；此处保持流打开，不 close，
        // 以模拟「连接未断但不再有数据」的供应商挂起
        if (plan.stallAfter === undefined) {
          controller.close();
        }
      } catch {
        try { controller.error(new Error('mock stream failed')); } catch { /* 已关闭 */ }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}
