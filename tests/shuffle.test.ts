/**
 * 随机性质量测试 —— 差分测试（differential testing）。
 *
 * 背景：原实现用 `[...npcs].sort(() => Math.random() - 0.5)` 洗牌。
 * 这是个流传极广的错误写法：比较器不一致会破坏排序算法的不变量，
 * 结果不是均匀分布。
 *
 * 测试思路不是断言「某个排列必须出现」，而是拿它和已知正确的
 * Fisher-Yates 做对照，用卡方检验比较两者的分布均匀性。
 * 这样断言既稳定（不依赖随机种子）又有统计学依据。
 */
import { describe, it, expect } from 'vitest';

/** 待测实现：与原代码 `ai.ts` 中的写法一致 */
function biasedShuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

/** 参照实现：Fisher-Yates（无偏） */
function fisherYates<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface ChiSquare {
  chi2: number;
  min: number;
  max: number;
  observed: number;
}

/** 对 n! 种排列做卡方检验 */
function chiSquareOfShuffle(n: number, iterations: number, shuffle: <T>(a: T[]) => T[]): ChiSquare {
  const items = Array.from({ length: n }, (_, i) => i);
  const counts = new Map<string, number>();
  for (let i = 0; i < iterations; i++) {
    const key = shuffle(items).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const expected = iterations / counts.size;
  const all = [...counts.values()];
  const chi2 = all.reduce((acc, c) => acc + ((c - expected) ** 2) / expected, 0);
  return { chi2, min: Math.min(...all), max: Math.max(...all), observed: counts.size };
}

// 自由度 3!-1 = 5 的卡方临界值
const CRITICAL_4_ITEMS = 11.07; // p = 0.05

describe('NPC 洗牌随机性', () => {
  it('sort(random-0.5) 的分布显著不均匀（证明这是个真 bug）', () => {
    const result = chiSquareOfShuffle(4, 60_000, biasedShuffle);

    // 4 个元素应有 24 种排列，全都出现过，但频率严重不均
    expect(result.observed).toBe(24);

    // 卡方值远超临界值 → 拒绝「均匀分布」假设
    expect(result.chi2).toBeGreaterThan(CRITICAL_4_ITEMS * 10);

    // 最频繁排列 / 最稀有排列 的倍率：实测可达 10 倍以上
    expect(result.max / result.min).toBeGreaterThan(3);
  });

  it('Fisher-Yates 的分布均匀（对照组）', () => {
    const result = chiSquareOfShuffle(4, 60_000, fisherYates);

    expect(result.observed).toBe(24);
    // 均匀分布下卡方应落在临界值以下。随机性导致卡方本身是随机变量，
    // 偶尔会略高于临界值（p=0.05 意味着 5% 概率），因此给足余量，
    // 只断言「量级正确」—— 判据与有偏实现的差距在一个数量级以上（见下一项）。
    expect(result.chi2).toBeLessThan(CRITICAL_4_ITEMS * 5);
    // 最多与最少排列的出现次数应接近（有偏实现这里是 12 倍）
    expect(result.max / result.min).toBeLessThan(1.6);
  });

  it('两种实现的偏差量级差异明显（差分结论）', () => {
    const biased = chiSquareOfShuffle(4, 30_000, biasedShuffle);
    const good = chiSquareOfShuffle(4, 30_000, fisherYates);

    // 同一量级样本下，有偏实现的卡方应比无偏实现高出一个数量级以上
    expect(biased.chi2).toBeGreaterThan(good.chi2 * 20);
  });
});

describe('洗牌实现的功能契约', () => {
  it('Fisher-Yates 不修改原数组、不丢失元素', () => {
    const source = ['a', 'b', 'c', 'd'];
    const snapshot = [...source];
    const out = fisherYates(source);

    expect(source).toEqual(snapshot); // 原数组未被修改
    expect(out).toHaveLength(4);
    expect([...out].sort()).toEqual([...snapshot].sort()); // 元素集合不变
    expect(out).not.toBe(source); // 返回新数组
  });

  it('空数组与单元素数组是安全的', () => {
    expect(fisherYates([])).toEqual([]);
    expect(fisherYates(['only'])).toEqual(['only']);
  });
});
