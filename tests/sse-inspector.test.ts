/**
 * 检测工具的元测试（meta-test）。
 *
 * 目的：证明 sse-inspector **本身是可信的**。
 *
 * 逻辑：拿 sse-fault-injector 生成的「已知根因」坏流喂给 diagnose()，
 * 断言判定结果与 groundTruth 一致。
 * 只有通过这组测试，才有资格用它去判定真实抓包的结果 ——
 * 否则工具的输出只是另一个猜测。
 */
import { describe, it, expect } from 'vitest';
import { parseSseStream, diagnose, renderReport } from '../tools/sse-inspector';
import { allScenarios } from '../tools/sse-fault-injector';

describe('SSE 检测工具：元测试（用已知答案验证工具）', () => {
  for (const sc of allScenarios()) {
    it(`场景「${sc.name}」应判定为 ${sc.groundTruth}`, () => {
      const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
      const d = diagnose(parsed);

      expect(d.verdict).toBe(sc.groundTruth);
      // 判定必须给出推理依据，不能是黑盒输出
      expect(d.reasoning.length).toBeGreaterThan(0);
    });
  }
});

describe('检测工具：不应把正常现象误判为故障', () => {
  it('帧被切成多次到达时，不应误判为乱序', () => {
    const sc = allScenarios().find(s => s.name.includes('切断'))!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });

    expect(parsed.observedFrameSplit).toBe(true);       // 确实观测到了切断
    expect(diagnose(parsed).verdict).toBe('NO_DISORDER'); // 但不算故障
  });

  it('正常流不应产生任何违例', () => {
    const sc = allScenarios().find(s => s.name === '正常流')!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    const d = diagnose(parsed);

    expect(d.stats.duplicateCount).toBe(0);
    expect(d.stats.reorderCount).toBe(0);
    expect(d.stats.garbledCount).toBe(0);
  });

  it('正常流按到达顺序拼接即等于期望文本', () => {
    const sc = allScenarios().find(s => s.name === '正常流')!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    expect(parsed.arrivalText).toBe(sc.expectedText);
  });
});

describe('检测工具：能力边界（该说不确定时就要说不确定）', () => {
  it('无 id 游标的乱序必须判为证据不足，而不是硬给结论', () => {
    const sc = allScenarios().find(s => s.name.includes('无 id'))!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    const d = diagnose(parsed);

    expect(d.verdict).toBe('INCONCLUSIVE');
    expect(d.confidence).toBe('low');
    // 必须解释清楚「为什么判不了」以及「还需要什么证据」
    const joined = d.reasoning.join('');
    expect(joined).toMatch(/游标|无法/);
    expect(joined).toMatch(/对照实验|两个独立消费者/);
    // 必须给出可执行的下一步，而不是只说「不知道」
    expect(joined).toMatch(/按到达顺序直接拼接/);
  });

  it('带 id 的传输层重排应能高置信度定位，并给出 id 回退证据', () => {
    const sc = allScenarios().find(s => s.name.includes('传输层'))!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    const d = diagnose(parsed);

    expect(d.verdict).toBe('TRANSPORT_REORDER');
    expect(d.confidence).toBe('high');
    expect(d.violations.some(v => v.kind === 'ID_REGRESSION')).toBe(true);
  });
});

describe('检测工具：内容损坏 vs 顺序错乱 必须分开', () => {
  it('内容损坏判为 SERVER_CONTENT，不是任何一类乱序', () => {
    const sc = allScenarios().find(s => s.name.includes('内容损坏'))!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    const d = diagnose(parsed);

    expect(d.verdict).toBe('SERVER_CONTENT');
    expect(d.stats.garbledCount).toBeGreaterThan(0);
    // 不应被误判成重排
    expect(d.verdict).not.toBe('TRANSPORT_REORDER');
    expect(d.verdict).not.toBe('CONSUMPTION_REORDER');
  });

  it('重复帧被计入传输侧统计', () => {
    const sc = allScenarios().find(s => s.name.includes('重复帧'))!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    const d = diagnose(parsed);

    expect(d.stats.duplicateCount).toBeGreaterThan(0);
  });
});

describe('报告渲染', () => {
  it('报告包含判定、置信度与依据', () => {
    const sc = allScenarios().find(s => s.name.includes('传输层'))!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    const text = renderReport(diagnose(parsed), parsed);

    expect(text).toContain('SSE 流体检报告');
    expect(text).toContain('判定');
    expect(text).toContain('置信度');
    expect(text).toContain('判定依据');
    expect(text).toContain('传输/代理层重排');
  });
});

describe('解析器自身的不变量', () => {
  it('跨 chunk 的半帧不会被切成两个残帧', () => {
    const sc = allScenarios().find(s => s.name === '正常流')!;
    const parsed = parseSseStream(sc.chunks, { expectedText: sc.expectedText });
    // 内容帧数量应等于注入的内容帧数（不含 [DONE] 与终止帧）
    expect(parsed.contents.length).toBeGreaterThanOrEqual(4);
    // 没有畸形 JSON 违例
    expect(parsed.violations.filter(v => v.kind === 'GARBLED_CONTENT')).toHaveLength(0);
  });

  it('注释/心跳帧不影响文本拼接', () => {
    const chunks = [
      { atMs: 0, text: ': keep-alive\n\n' },
      { atMs: 10, text: 'data: {"choices":[{"index":0,"delta":{"content":"甲"},"finish_reason":null}]}\n\n' },
      { atMs: 20, text: ': ping\n\n' },
      { atMs: 30, text: 'data: {"choices":[{"index":0,"delta":{"content":"乙"},"finish_reason":null}]}\n\n' },
    ];
    const parsed = parseSseStream(chunks);
    expect(parsed.arrivalText).toBe('甲乙');
    expect(parsed.frames.filter(f => f.isComment)).toHaveLength(2);
  });
});
