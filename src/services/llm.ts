import OpenAI from "openai";
import {
  SequencedConsumer,
  extractCompletionText,
  extractDeltaFrame,
} from "./stream";

/** 语言引擎配置 */
export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  /** 单次请求上限，防止无限挂起占住 UI */
  timeoutMs: number;
  /**
   * 流式空闲超时：两个分片之间的最大允许间隔。
   * `timeoutMs` 只覆盖建连阶段，一旦流打开就不再生效；
   * 没有这个的话，供应商挂起会让 for await 永远卡住 → UI 永久锁死。
   */
  idleMs: number;
  /** 测试注入用的自定义 fetch；生产为 undefined（走全局 fetch） */
  fetch?: typeof fetch;
}

export const DEFAULT_MODEL = "deepseek-v4-flash";

/** 读一次配置来源：浏览器读 localStorage，Node 读环境变量 */
function readRawConfig(): { apiKey: string; model: string; baseURL: string } {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    return {
      apiKey: localStorage.getItem("DEEPSEEK_API_KEY")?.trim() || "",
      model: localStorage.getItem("DEEPSEEK_MODEL")?.trim() || DEFAULT_MODEL,
      baseURL: localStorage.getItem("DEEPSEEK_BASE_URL")?.trim() || "https://api.deepseek.com",
    };
  }
  // Node 侧（如 survival_demo.ts 的离线跑批）走环境变量
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return {
    apiKey: env?.DEEPSEEK_API_KEY?.trim() || "",
    model: env?.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
    baseURL: env?.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  };
}

/** 读一次配置，空 Key 视为未配置 */
export function readUserConfig(): LLMConfig | null {
  const raw = readRawConfig();
  if (!raw.apiKey) return null;
  return { ...raw, timeoutMs: 45_000, idleMs: 20_000 };
}

export class MissingKeyError extends Error {
  constructor() {
    super("未配置 DEEPSEEK_API_KEY");
    this.name = "MissingKeyError";
  }
}

/** 流式回调：每收到一段增量文本触发一次 */
export type OnDelta = (delta: string) => void;

export interface StreamCallbacks {
  onDelta: OnDelta;
  /** 首帧到达时触发，用于测量 TTFT */
  onFirstToken?: () => void;
  /** 由调用方传入的取消信号 */
  signal?: AbortSignal;
}

/**
 * 白盒指标：一次调用的可观测数据。
 * 这些数字是「模型推理占用户感知等待比例」这类结论的唯一依据 ——
 * 不埋点就只能靠猜。
 */
export interface CallMetrics {
  ttftMs: number;
  totalMs: number;
  chunks: number;
  chars: number;
  /** 供应商乱序分片数，>0 表示消费顺序守卫确实起了作用 */
  outOfOrderChunks: number;
  model: string;
}

export interface CallResult {
  text: string;
  metrics: CallMetrics;
}

export interface LLMAdapter {
  config: LLMConfig;
  /** 底层 client，仅用于连通性探测 */
  client: OpenAI;
  complete(prompt: string, opts?: { json?: boolean; signal?: AbortSignal }): Promise<CallResult>;
  stream(prompt: string, cb: StreamCallbacks): Promise<CallResult>;
}

/**
 * 客户端 → 目标服务的连接探测。
 *
 * 关键点：只在「连接级失败」时判死。HTTP 400/401/429 这类
 * 业务级错误说明链路本身是通的（Key 无效、额度不足、参数问题），
 * 应该把真实错误抛给用户，而不是静默回退到一个不存在的备选引擎。
 */
async function probe(client: OpenAI, config: LLMConfig, signal?: AbortSignal): Promise<void> {
  try {
    await client.chat.completions.create(
      {
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      },
      { signal, timeout: 15_000 },
    );
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === undefined) {
      // 连接级失败：DNS / TLS / 网络不可达
      throw new Error("无法连接 DeepSeek 服务，请检查网络或 Base URL");
    }
    // 业务级失败：链路可用，交给真实请求去暴露具体错误
  }
}

export class StreamIdleTimeoutError extends Error {
  constructor(idleMs: number) {
    super(`流式响应超过 ${idleMs}ms 没有新数据，已中止`);
    this.name = 'StreamIdleTimeoutError';
  }
}

/**
 * 已知局限（不修，写明）：断流重连后服务端重放已发分片时，客户端**无法**安全去重。
 *
 * 原因：SSE 分片是无状态的文本增量，同一段文本既可能是合法的重复内容
 * （玩家回复里连续两个"嗯"），也可能是重放。没有服务端游标就无法区分。
 *
 * 安全的去重必须依赖协议层的单调游标：
 *   - 请求头带 `Last-Event-ID`，服务端从该点续传（OpenAI 兼容接口不支持）
 *   - 或响应 SSE 事件带 `id:` 字段，据此丢弃已消费的 id
 *
 * 当前采取的策略是「宁可重复，不可丢失」：重复内容对游戏是一句略怪的
 * 发言，丢字则可能让语义反转。tests/transport.test.ts 固定了这个行为。
 */
/**
 * 显式消费 SSE 响应体，并施加空闲超时。
 *
 * 为什么不直接用 `for await (const chunk of sdkStream)`：
 * openai SDK 的 fetchWithTimeout 在 `finally { clearTimeout(timeout) }` 里
 * 于 fetch() 返回的瞬间就清掉了计时器（见 node_modules/openai/client.js）。
 * 也就是说 SDK 的超时只覆盖「响应头到达」，**不覆盖响应体读取**。
 * 因此一旦供应商在流中途挂起，`for await` 会永久阻塞，且传 abort signal
 * 也无法中断——因为 abort 是在 fetch 阶段生效的。
 *
 * 唯一可靠的做法是自己拿到 reader，把「读一个分片」与「空闲计时器」竞速，
 * 超时就主动 cancel reader 让挂起的 read 解除并 reject。
 */
async function consumeSse<T>(
  response: Response,
  opts: {
    /** 每解出一个分片回调一次；返回 false 表示调用方要求停止消费 */
    onChunk: (chunk: T) => boolean | void;
    idleMs: number;
    external?: AbortSignal;
  },
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error('响应没有可读流');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleReject: ((e: Error) => void) | undefined;
  let timedOut = false;

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      idleReject?.(new StreamIdleTimeoutError(opts.idleMs));
    }, opts.idleMs);
  };

  const onExternalAbort = () => { void reader.cancel().catch(() => {}); };
  if (opts.external) {
    if (opts.external.aborted) throw new Error('请求已取消');
    opts.external.addEventListener('abort', onExternalAbort, { once: true });
  }

  /**
   * 取消检查：reader.cancel() 会让挂起的 read() 以 {done:true} 正常结束，
   * 而不是抛错。若不显式检查，取消会被当成「流正常结束」——
   * 于是返回一个被截断的文本，调用方完全看不出请求已被取消。
   */
  const throwIfCancelled = () => {
    if (opts.external?.aborted) {
      const err = new Error('请求已取消');
      err.name = 'AbortError';
      throw err;
    }
  };

  try {
    armIdle();
    for (;;) {
      // 把「读一个分片」与「空闲超时」竞速：超时则拒绝，不再等悬挂的 read
      const idle = new Promise<never>((_, reject) => { idleReject = reject; });
      const { done, value } = await Promise.race([reader.read(), idle]);
      throwIfCancelled();
      if (done) break;

      armIdle();
      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分帧；半帧留在 buffer 里等下一片
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue; // 跳过 `: ping` 注释与 id:/event: 行
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            if (opts.onChunk(JSON.parse(data) as T) === false) return;
          } catch {
            // 单个畸形帧不应中断整条流
          }
        }
      }
    }
    if (buffer.trim()) {
      // 流结束时残帧兜底：有些实现最后一帧不带 trailing 空行
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try { opts.onChunk(JSON.parse(data) as T); } catch { /* 同上 */ }
      }
    }
  } catch (error) {
    if (timedOut) throw new StreamIdleTimeoutError(opts.idleMs);
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    opts.external?.removeEventListener('abort', onExternalAbort);
    void reader.releaseLock?.();
  }
}

/** 把供应商错误翻译成玩家能看懂的一句话 */
export function toUserMessage(error: unknown): string {
  if (error instanceof MissingKeyError) {
    return "还没有配置 API Key。请在首页 [API 配置] 面板填入 DEEPSEEK_API_KEY。";
  }
  const status = (error as { status?: number })?.status;
  if (status === 401) return "API Key 无效，请检查是否填错或已失效。";
  if (status === 402) return "账户余额不足，请先充值。";
  if (status === 429) return "请求过于频繁（限流），稍等几秒再试。";
  if (status && status >= 500) return "DeepSeek 服务端暂时异常，稍后重试。";
  if ((error as Error)?.name === "AbortError") return "请求已取消。";
  return "学术委员会暂时失联，请检查网络或稍后重试。";
}

/** 构造适配器。导出以便测试注入 mock fetch（生产由 getAdapter 缓存复用） */
export function buildAdapter(config: LLMConfig): LLMAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    // ⚠️ dangerouslyAllowBrowser: true 意味着 API Key 在浏览器中明文使用。
    // 纯前端架构无法规避；若要更高安全性，应改为由 Express 后端代理转发。
    dangerouslyAllowBrowser: true,
    // 测试注入点：不传则 SDK 使用全局 fetch
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });

  let probePromise: Promise<void> | null = null;
  const ensureReachable = (signal?: AbortSignal) => {
    if (!probePromise) probePromise = probe(client, config, signal);
    return probePromise;
  };

  const complete: LLMAdapter["complete"] = async (prompt, opts) => {
    await ensureReachable(opts?.signal);
    const started = performance.now();
    const response = await client.chat.completions.create(
      {
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        response_format: opts?.json ? { type: "json_object" } : undefined,
      },
      { signal: opts?.signal, timeout: config.timeoutMs },
    );
    const text = extractCompletionText(response);
    const totalMs = performance.now() - started;
    return {
      text,
      metrics: {
        ttftMs: totalMs, // 非流式调用中，首字与整段同时到达
        totalMs,
        chunks: 1,
        chars: text.length,
        outOfOrderChunks: 0,
        model: config.model,
      },
    };
  };

  const stream: LLMAdapter["stream"] = async (prompt, cb) => {
    await ensureReachable(cb.signal);
    const started = performance.now();
    const consumer = new SequencedConsumer();

    // 用 SDK 发起请求，但只取到 Response，响应体由自己消费（见 consumeSse 注释）
    const response = await client.chat.completions
      .create(
        {
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        },
        { signal: cb.signal, timeout: config.timeoutMs },
      )
      .asResponse();

    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    }

    let text = "";
    let chunks = 0;
    let ttftMs = -1;

    await consumeSse<any>(response, {
      idleMs: config.idleMs,
      external: cb.signal,
      onChunk: (chunk) => {
        chunks += 1;
        const frame = extractDeltaFrame(chunk);
        // 按出现顺序编号后交给守卫：乱序分片会被挂起而非直接拼接
        const release = consumer.consume(frame.text, frame.finish);
        if (!release.text) return;

        text += release.text;
        if (ttftMs < 0) {
          ttftMs = performance.now() - started;
          cb.onFirstToken?.();
        }
        cb.onDelta(release.text);
      },
    });

    // 流结束仍有挂起分片（前序丢帧）时强制冲空，保证内容完整
    const tail = consumer.drain();
    if (tail.text) {
      text += tail.text;
      cb.onDelta(tail.text);
    }

    const totalMs = performance.now() - started;
    return {
      text,
      metrics: {
        ttftMs: ttftMs < 0 ? totalMs : ttftMs,
        totalMs,
        chunks,
        chars: text.length,
        outOfOrderChunks: consumer.reorderCount,
        model: config.model,
      },
    };
  };

  return { config, client, complete, stream };
}

let cached: { key: string; adapter: LLMAdapter } | null = null;

/**
 * 取当前适配器。
 * 读不到 Key 时抛 MissingKeyError，由 UI 转成「去配置」的提示 ——
 * 不做静默降级，避免真实错误被吞掉。
 */
export async function getAdapter(): Promise<LLMAdapter> {
  const config = readUserConfig();
  if (!config) throw new MissingKeyError();

  const cacheKey = `${config.apiKey}|${config.model}|${config.baseURL}`;
  if (cached?.key === cacheKey) return cached.adapter;

  const adapter = buildAdapter(config);
  // 探测失败则不缓存：等网络恢复后，下一次请求会重新探测，无需刷新页面
  await probe(adapter.client, config);
  cached = { key: cacheKey, adapter };
  return adapter;
}

/** 切换 Key 后清掉缓存，下一次请求立刻生效 */
export function resetAdapter(): void {
  cached = null;
}
