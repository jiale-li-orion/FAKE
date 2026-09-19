/**
 * 消费侧拼接错乱的复现实验。
 *
 * 目的：把「React setState 批处理导致流式增量错位」从推理变成可失败、可验证的实验。
 * 方法是各写一个「错误版本」和一个「正确版本」组件，用同一份注入式分片序列喂给它们，
 * 断言累积结果。
 *
 * 核心变量是分片的到达节奏：
 *   - 每帧一个独立任务 → React 批处理不合并，闭包被重新创建，错误写法也碰巧正确
 *   - 多帧落在同一个任务里 → 批处理合并，错误写法立刻错位
 * 第二种才是真实情况：SSE 高频到达时多个分片会落进同一个任务，
 * 这正是「低频不复现、换高吞吐模型才暴露」的机制来源。
 */
import { describe, it, expect, afterEach } from 'vitest';
import React, { useState, useRef, StrictMode } from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';

const BLOCKS = ['结构整体：', '清晰。', '核心是 Service Memory，', '由 Retrieve 与 Update 两阶段构成。'];
const EXPECTED = BLOCKS.join('');

/**
 * 每个用例独立持有 updater 引用。
 * 用模块级变量会让多个 render 互相覆盖（前一个组件残留的 updater 会写进
 * 后一个组件的 setState），产生与被测机制无关的假失败。
 */
function makeHandle<T extends (...args: any[]) => void>() {
  const ref: { fn: T | null } = { fn: null };
  return {
    set: (fn: T) => { ref.fn = fn; },
    call: (...args: Parameters<T>) => ref.fn!(...args),
  };
}

/** 在同一个任务里连续投递多帧，模拟 React 自动批处理合并 */
function deliverInOneTask(fn: (d: string) => void, deltas: string[]) {
  act(() => { deltas.forEach(d => fn(d)); });
}

/** 每帧一个任务 */
function deliverPerTask(fn: (d: string) => void, deltas: string[]) {
  deltas.forEach(d => act(() => { fn(d); }));
}

afterEach(() => cleanup());

// ─────────────────────────────────────────────
// 错误版本 1：非函数式更新，直接读闭包里的 state
// ─────────────────────────────────────────────
const naive = makeHandle<(d: string) => void>();

function NaiveClosureAccumulator() {
  const [text, setText] = useState('');
  naive.set(d => setText(text + d));
  return <div data-testid="naive-closure">{text}</div>;
}

const naiveText = () => screen.getByTestId('naive-closure').textContent!;

// ─────────────────────────────────────────────
// 错误版本 2：通过 ref 读「最新值」，但 ref 只在渲染时同步
// ─────────────────────────────────────────────
const viaRef = makeHandle<(d: string) => void>();

function RefSnapshotMismatch() {
  const [text, setText] = useState('');
  const latest = useRef('');
  latest.current = text;
  viaRef.set(d => setText(latest.current + d));
  return <div data-testid="bad-ref">{text}</div>;
}

const refText = () => screen.getByTestId('bad-ref').textContent!;

// ─────────────────────────────────────────────
// 错误版本 3：多路流共用一个累加器（不分桶）
// ─────────────────────────────────────────────
const shared = makeHandle<(key: string, d: string) => void>();

function SharedAccumulator() {
  const [text, setText] = useState('');
  shared.set((_key, d) => setText(prev => prev + d));
  return <div data-testid="shared">{text}</div>;
}

const sharedText = () => screen.getByTestId('shared').textContent!;

// ─────────────────────────────────────────────
// 正确版本：函数式更新 + 按来源分桶（与项目实现一致）
// ─────────────────────────────────────────────
const good = makeHandle<(key: string, d: string) => void>();

function FunctionalBucketed() {
  const [replies, setReplies] = useState<Record<string, string>>({});
  good.set((key, d) => setReplies(prev => ({ ...prev, [key]: (prev[key] || '') + d })));
  return <div data-testid="functional">{replies.npc_0 || ''}</div>;
}

const goodText = () => screen.getByTestId('functional').textContent!;

// ═══════════════════════════════════════════
describe('错误版本 1：非函数式更新（读闭包快照）', () => {
  it('低频：每帧一个任务时碰巧正确', () => {
    render(<NaiveClosureAccumulator />);
    deliverPerTask(d => naive.call(d), BLOCKS);
    expect(naiveText()).toBe(EXPECTED);
  });

  it('高频：多帧同一任务时，中间分片被覆盖，只剩最后一次写入', () => {
    render(<NaiveClosureAccumulator />);
    deliverInOneTask(d => naive.call(d), BLOCKS);

    // 实测形态：只剩最后一个分片。每帧都算过一次，
    // 但五次 setState 都基于同一个批处理前的快照，最终只有最后一次生效。
    expect(naiveText()).toBe(BLOCKS[BLOCKS.length - 1]);
    expect(naiveText()).not.toBe(EXPECTED);
  });

  it('逐字符下发时，只剩最后一个字符（极端形态，最接近碎片化外观）', () => {
    render(<NaiveClosureAccumulator />);
    const chars = [...EXPECTED];
    deliverInOneTask(d => naive.call(d), chars);
    expect(naiveText()).toBe(chars[chars.length - 1]);
    expect(naiveText()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
describe('错误版本 2：ref 快照在批处理期间不更新', () => {
  it('高频：同样丢失中间分片', () => {
    render(<RefSnapshotMismatch />);
    deliverInOneTask(d => viaRef.call(d), BLOCKS);

    expect(refText()).toBe(BLOCKS[BLOCKS.length - 1]);
    expect(refText()).not.toBe(EXPECTED);
  });

  it('低频：ref 随渲染同步，碰巧正确', () => {
    render(<RefSnapshotMismatch />);
    deliverPerTask(d => viaRef.call(d), BLOCKS);
    expect(refText()).toBe(EXPECTED);
  });
});

// ═══════════════════════════════════════════
describe('错误版本 3：多路流共用一个累加器', () => {
  it('两路分片交错，得到穿插结果，既不等于原文也不丢内容', () => {
    render(<SharedAccumulator />);
    const interleaved = ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'];
    deliverInOneTask(d => shared.call('any', d), interleaved);

    // 这正是「块都在、位置互相穿插」的形态
    expect(sharedText()).toBe('A1B1A2B2A3B3');
    expect(sharedText()).not.toBe('A1A2A3');
    expect(sharedText()).not.toBe('B1B2B3');
  });
});

// ═══════════════════════════════════════════
describe('正确版本：函数式更新 + 分桶', () => {
  it('高频与低频两种节奏下都严格有序', () => {
    const r1 = render(<FunctionalBucketed />);
    deliverInOneTask(d => good.call('npc_0', d), BLOCKS);
    expect(goodText()).toBe(EXPECTED);
    r1.unmount();

    const r2 = render(<FunctionalBucketed />);
    deliverPerTask(d => good.call('npc_0', d), BLOCKS);
    expect(goodText()).toBe(EXPECTED);
    r2.unmount();
  });

  it('按来源分桶时，两路交错也不串味', () => {
    render(<FunctionalBucketed />);
    deliverInOneTask(d => good.call('npc_0', d), ['A1', 'A2', 'A3']);
    expect(goodText()).toBe('A1A2A3');
  });
});

// ═══════════════════════════════════════════
describe('判别实验：同一份输入，只改到达节奏', () => {
  it('「低频正确、高频错位」是批处理类机制独有的指纹', () => {
    // 错误版本：节奏一变，结果就变
    const a = render(<NaiveClosureAccumulator />);
    deliverPerTask(d => naive.call(d), BLOCKS);
    const perTask = naiveText();
    a.unmount();

    const b = render(<NaiveClosureAccumulator />);
    deliverInOneTask(d => naive.call(d), BLOCKS);
    const batched = naiveText();
    b.unmount();

    expect(perTask).toBe(EXPECTED);
    expect(batched).not.toBe(EXPECTED);

    // 正确版本：节奏不变结论，两种都给同一结果
    const c = render(<FunctionalBucketed />);
    deliverPerTask(d => good.call('npc_0', d), BLOCKS);
    const goodPerTask = goodText();
    c.unmount();

    const d2 = render(<FunctionalBucketed />);
    deliverInOneTask(x => good.call('npc_0', x), BLOCKS);
    const goodBatched = goodText();
    d2.unmount();

    expect(goodPerTask).toBe(EXPECTED);
    expect(goodBatched).toBe(EXPECTED);
  });
});

// ═══════════════════════════════════════════
describe('StrictMode：updater 里的副作用会被重复调用', () => {
  it('开发模式下 updater 被多调用，纯累积结果仍正确', () => {
    let calls = 0;
    const h = makeHandle<(d: string) => void>();

    function Impure() {
      const [text, setText] = useState('');
      h.set(d => setText(prev => { calls += 1; return prev + d; }));
      return <div data-testid="impure">{text}</div>;
    }

    render(<StrictMode><Impure /></StrictMode>);
    deliverInOneTask(d => h.call(d), ['a', 'b']);

    // 调用次数多于分片数：StrictMode 会重复调用 updater 以暴露副作用。
    // 累积结果仍对，因为纯函数满足结合律；
    // 但若 updater 里做的是去重、发请求、改外部缓冲，开发环境会出现生产没有的重复。
    expect(calls).toBeGreaterThan(2);
    expect(screen.getByTestId('impure').textContent).toBe('ab');
  });
});

// ═══════════════════════════════════════════
describe('不变量：到达顺序拼接必须等于期望文本', () => {
  function run(deltas: string[], mode: 'per-task' | 'batched'): string {
    const r = render(<FunctionalBucketed />);
    if (mode === 'batched') deliverInOneTask(d => good.call('npc_0', d), deltas);
    else deliverPerTask(d => good.call('npc_0', d), deltas);
    const got = goodText();
    r.unmount();
    return got;
  }

  it('两种节奏下都满足', () => {
    expect(run(BLOCKS, 'per-task')).toBe(EXPECTED);
    expect(run(BLOCKS, 'batched')).toBe(EXPECTED);
  });

  it('切成单字符时满足', () => {
    const chars = [...EXPECTED];
    expect(run(chars, 'batched')).toBe(EXPECTED);
    expect(run(chars, 'per-task')).toBe(EXPECTED);
  });

  it('空帧不影响累积', () => {
    const withEmpty = ['结构整体：', '', '清晰。', '', ...BLOCKS.slice(2)];
    expect(run(withEmpty, 'batched')).toBe(EXPECTED);
  });
});
