/**
 * L2 传输层测试 —— 用注入式 SSE 夹具复现真实的流式故障模式。
 *
 * 这一层是最容易出真 bug 的地方，因为它是唯一与不可控外部系统
 * （LLM 厂商）交互的边界。测的不是"能不能收到回复"，而是
 * "收到的东西被消费之后，客户端状态是否仍然正确"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAdapter, StreamIdleTimeoutError, toUserMessage } from '../src/services/llm';
import type { LLMConfig } from '../src/services/llm';
import { createMockTransport } from './fixtures/mock-transport';

const BASE: LLMConfig = {
  apiKey: 'sk-test',
  baseURL: 'https://api.deepseek.com',
  model: 'mock-model',
  timeoutMs: 5_000,
  idleMs: 300, // 测试里放大到可观测的尺度
};

/** 便捷构造：注入 mock 传输层的适配器 */
function makeAdapter(overrides: Partial<LLMConfig> = {}, transport = createMockTransport()) {
  return { adapter: buildAdapter({ ...BASE, fetch: transport.fetch, ...overrides }), transport };
}

/** 收集所有增量回调 */
function collect() {
  const deltas: string[] = [];
  return {
    deltas,
    get text() { return deltas.join(''); },
    onDelta: (d: string) => deltas.push(d),
  };
}

// ══════════════════════════════════════════
describe('流式内容完整性', () => {
  it('逐字分片下，拼接结果等于生成顺序的文本', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushStream({ chunks: ['你好', '，', '我是', '新来的'] });

    const sink = collect();
    const result = await adapter.stream('prompt', { onDelta: sink.onDelta });

    expect(result.text).toBe('你好，我是新来的');
    expect(sink.text).toBe(result.text); // 回调拼接 === 返回值，前端与状态不会分叉
  });

  it('SSE 帧跨 reader chunk 被切断时文本仍完整', async () => {
    const { adapter, transport } = makeAdapter();
    // chunkSize 让每个逻辑分片再切成 3 段下发，制造帧边界切断
    transport.pushStream({ chunks: ['第一句话', '第二句话'], chunkSize: 3 });

    const result = await adapter.stream('p', { onDelta: () => {} });
    expect(result.text).toBe('第一句话第二句话');
  });

  it('空 delta 帧与心跳注释帧不产生内容、不触发首字', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushStream({ chunks: ['内容'], emptyDeltas: true, keepAlive: true });

    const onFirstToken = vi.fn();
    const result = await adapter.stream('p', { onDelta: () => {}, onFirstToken });

    expect(result.text).toBe('内容');
    expect(onFirstToken).toHaveBeenCalledTimes(1);
  });

  it('首字延迟被记录，且不大于总耗时', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushStream({ chunks: ['a', 'b', 'c'], delayMs: 15 });

    const result = await adapter.stream('p', { onDelta: () => {} });

    expect(result.metrics.ttftMs).toBeGreaterThan(0);
    expect(result.metrics.ttftMs).toBeLessThanOrEqual(result.metrics.totalMs);
    expect(result.metrics.chunks).toBeGreaterThan(0);
    expect(result.metrics.chars).toBe(result.text.length);
  });
});

// ══════════════════════════════════════════
describe('流式挂起保护（本轮修复的核心 bug）', () => {
  it('供应商中途静默时，空闲看门狗中止流而不是永久挂起', async () => {
    const { adapter, transport } = makeAdapter({ idleMs: 250 });
    // 发两片后彻底静默，且不关闭流 —— 模拟供应商 stall
    transport.pushStream({ chunks: ['开头', '然后挂起'], delayMs: 10, stallAfter: 2 });

    const started = Date.now();
    await expect(adapter.stream('p', { onDelta: () => {} }))
      .rejects.toBeInstanceOf(StreamIdleTimeoutError);
    const elapsed = Date.now() - started;

    // 必须在空闲窗口附近中止，而不是无限等待
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('看门狗在持续有新数据时不会误伤长回复', async () => {
    const { adapter, transport } = makeAdapter({ idleMs: 200 });
    // 15 片 × 30ms 间隔 = 450ms 总时长，远超 idleMs，但每片都在重置计时
    transport.pushStream({
      chunks: Array.from({ length: 15 }, (_, i) => `第${i + 1}段`),
      delayMs: 30,
    });

    const result = await adapter.stream('p', { onDelta: () => {} });

    expect(result.text).toContain('第1段');
    expect(result.text).toContain('第15段');
  });

  it('中断后可重新发起请求（看门狗状态不泄漏）', async () => {
    const { adapter, transport } = makeAdapter({ idleMs: 200 });
    transport.pushStream({ chunks: ['x'], stallAfter: 1 });
    transport.pushStream({ chunks: ['恢复', '正常'] });

    await expect(adapter.stream('p', { onDelta: () => {} })).rejects.toBeInstanceOf(StreamIdleTimeoutError);

    const result = await adapter.stream('p', { onDelta: () => {} });
    expect(result.text).toBe('恢复正常');
  });
});

// ══════════════════════════════════════════
describe('取消语义', () => {
  it('外部 AbortSignal 中止后请求 reject，不悬挂', async () => {
    const { adapter, transport } = makeAdapter({ idleMs: 5_000 });
    transport.pushStream({ chunks: ['a', 'b', 'c', 'd', 'e'], delayMs: 40 });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);

    await expect(
      adapter.stream('p', { onDelta: () => {}, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('已中止的 signal 立即失败', async () => {
    const { adapter, transport } = makeAdapter({ idleMs: 5_000 });
    transport.pushStream({ chunks: ['a'] });

    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.stream('p', { onDelta: () => {}, signal: controller.signal }),
    ).rejects.toThrow();
  });
});

// ══════════════════════════════════════════
describe('已知局限：重连重放无法安全去重', () => {
  it('重复下发的分片被原样拼接（策略是宁可重复，不可丢失）', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushStream({ chunks: ['重', '放'], duplicate: 2 });

    const result = await adapter.stream('p', { onDelta: () => {} });

    // 固定当前行为：每个分片下发 2 次 → 文本逐片重复。
    // 选择「重复」而不是「丢弃」是刻意的：重复内容对游戏只是一句略怪的发言，
    // 而误删合法重复内容（如连续两个"嗯"）会让语义反转。
    expect(result.text).toBe('重重放放');

    // 真正的去重需要协议层单调游标（SSE `id:` 字段 / Last-Event-ID），
    // OpenAI 兼容接口不提供。见 src/services/llm.ts 的局限说明。
    expect(result.text.length).toBe('重放'.length * 2);
  });
});

// ══════════════════════════════════════════
describe('错误分类与用户提示', () => {
  it('401 → Key 无效', () => {
    expect(toUserMessage({ status: 401 })).toContain('API Key 无效');
  });

  it('402 → 余额不足', () => {
    expect(toUserMessage({ status: 402 })).toContain('余额不足');
  });

  it('429 → 限流', () => {
    expect(toUserMessage({ status: 429 })).toContain('频繁');
  });

  it('5xx → 服务端异常', () => {
    expect(toUserMessage({ status: 503 })).toContain('服务端');
  });

  it('AbortError → 请求已取消', () => {
    expect(toUserMessage({ name: 'AbortError' })).toContain('取消');
  });

  it('未知错误 → 兜底提示（不泄露堆栈）', () => {
    const msg = toUserMessage(new Error('ECONNRESET at socket 0xdeadbeef'));
    expect(msg).not.toContain('0xdeadbeef');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('非流式请求遇到 500 时抛出可分类的错误', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushNonStream({ content: '{}', status: 500 });

    await expect(adapter.complete('p', { json: true })).rejects.toMatchObject({ status: 500 });
  });
});

// ══════════════════════════════════════════
describe('非流式调用', () => {
  it('返回文本并带上请求体约定的 response_format', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushNonStream({ content: '{"ok":true}' });

    const result = await adapter.complete('p', { json: true });

    expect(result.text).toBe('{"ok":true}');
    expect(transport.requests.at(-1)?.body.response_format).toEqual({ type: 'json_object' });
    expect(transport.requests.at(-1)?.stream).toBe(false);
  });

  it('不开 json 时不发送 response_format', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushNonStream({ content: '纯文本' });

    await adapter.complete('p');

    expect(transport.requests.at(-1)?.body.response_format).toBeUndefined();
  });

  it('流式调用会在请求体里带 stream:true', async () => {
    const { adapter, transport } = makeAdapter();
    transport.pushStream({ chunks: ['a'] });

    await adapter.stream('p', { onDelta: () => {} });

    expect(transport.requests.at(-1)?.stream).toBe(true);
  });
});

// ══════════════════════════════════════════
describe('连通性探测', () => {
  let transport = createMockTransport();
  beforeEach(() => { transport = createMockTransport(); });
  afterEach(() => { transport.reset(); });

  it('业务级失败（401）不阻断链路，真实请求照常发出', async () => {
    const { adapter } = makeAdapter({}, transport);
    // 探测请求返回 401，真实请求返回正常内容
    transport.pushNonStream({ content: '{}', status: 401 });
    transport.pushNonStream({ content: '{"judge":"ok"}' });

    const result = await adapter.complete('p', { json: true });

    expect(result.text).toBe('{"judge":"ok"}');
  });
});
