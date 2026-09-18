/**
 * 流式解码层回归测试。
 *
 * 覆盖的都是「真机上偶发、但一旦发生玩家就会看到错字/卡死」的场景：
 * 分片乱序、丢帧、JSON 围栏、围栏未配平。
 *
 * 运行：npm test
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  ChunkOrderGuard,
  SequencedConsumer,
  extractCompletionText,
  extractDeltaFrame,
  parseJsonLoose,
} from '../src/services/stream';

// ══════════════════════════════════════════
// 消费顺序守卫
// ══════════════════════════════════════════

test('顺序到达时逐帧放行', () => {
  const guard = new ChunkOrderGuard();
  assert.equal(guard.push({ seq: 0, text: '你' }).text, '你');
  assert.equal(guard.push({ seq: 1, text: '好' }).text, '好');
  assert.equal(guard.hasGap, false);
});

test('乱序到达时仍按生成顺序拼接', () => {
  const guard = new ChunkOrderGuard();

  // 第 1 帧先到：seq=1 而非 0，必须挂起而不是直接拼接
  const late = guard.push({ seq: 1, text: '世界' });
  assert.equal(late.text, '');
  assert.equal(late.reordered, true);
  assert.equal(guard.hasGap, true);

  // 第 0 帧补上：应一次性吐出「你好世界」，而不是「世界你好」
  const filled = guard.push({ seq: 0, text: '你好' });
  assert.equal(filled.text, '你好世界');
  assert.equal(guard.hasGap, false);
});

test('多帧乱序也能还原：2,0,1 → 拼接结果仍是 ABC', () => {
  const guard = new ChunkOrderGuard();
  // 2 先到：挂起
  assert.equal(guard.push({ seq: 2, text: 'C' }).text, '');
  // 0 到达：它就是当前应有的下一帧，立即放行。
  // 不因为「后面还有个 1 没到」而卡住 —— 已经安全的文本必须马上可见。
  assert.equal(guard.push({ seq: 0, text: 'A' }).text, 'A');
  // 1 补上：连同挂起的 2 一起吐出
  assert.equal(guard.push({ seq: 1, text: 'B' }).text, 'BC');
});

test('前序丢帧时 flush 兜底，不永久阻塞', () => {
  const guard = new ChunkOrderGuard();
  guard.push({ seq: 0, text: '有' });
  guard.push({ seq: 2, text: '尾' }); // seq=1 永远丢失

  assert.equal(guard.hasGap, true);
  const flushed = guard.flush();
  assert.equal(flushed.text, '尾');
  assert.equal(guard.hasGap, false);
});

test('迟到分片在 flush 之后被丢弃，不重复拼接', () => {
  const guard = new ChunkOrderGuard();
  guard.push({ seq: 0, text: 'A' });
  guard.push({ seq: 2, text: 'C' });
  assert.equal(guard.flush().text, 'C');

  // seq=1 此时才到，已经被判定丢失并冲空过 —— 应丢弃而不是再拼一次
  assert.equal(guard.push({ seq: 1, text: 'B' }).text, '');
});

test('重复 seq 被幂等丢弃', () => {
  const guard = new ChunkOrderGuard();
  assert.equal(guard.push({ seq: 0, text: 'A' }).text, 'A');
  assert.equal(guard.push({ seq: 0, text: 'A' }).text, '');
  assert.equal(guard.push({ seq: 1, text: 'B' }).text, 'B');
});

test('SequencedConsumer 按出现顺序编号，并统计乱序分片数', () => {
  const consumer = new SequencedConsumer();
  // 消费侧永远按出现顺序编号，因此正常情况下不会乱序
  assert.equal(consumer.consume('甲').text, '甲');
  assert.equal(consumer.consume('').text, ''); // usage-only 空帧不产生增量
  assert.equal(consumer.consume('乙').text, '乙');
  assert.equal(consumer.reorderCount, 0);
  assert.equal(consumer.drain().text, '');
});

// ══════════════════════════════════════════
// 供应商响应解码
// ══════════════════════════════════════════

test('提取非流式响应文本，字段缺失返回空串', () => {
  assert.equal(extractCompletionText({ choices: [{ message: { content: 'ok' } }] }), 'ok');
  assert.equal(extractCompletionText({ choices: [] }), '');
  assert.equal(extractCompletionText(null), '');
  assert.equal(extractCompletionText({ choices: [{ message: { content: null } }] }), '');
});

test('提取流式增量帧，usage-only 帧文本为空', () => {
  assert.deepEqual(
    extractDeltaFrame({ choices: [{ delta: { content: '你' }, finish_reason: null }] }),
    { text: '你', finish: false },
  );
  assert.deepEqual(
    extractDeltaFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    { text: '', finish: true },
  );
  assert.deepEqual(extractDeltaFrame({}), { text: '', finish: false });
});

// ══════════════════════════════════════════
// JSON 容错解析
// ══════════════════════════════════════════

test('解析干净 JSON', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
});

test('剥掉 ```json 围栏', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```\n{"a":1}\n```'), { a: 1 });
});

test('剥掉 BOM 与前后空白', () => {
  assert.deepEqual(parseJsonLoose('\uFEFF  {"a":1}  '), { a: 1 });
});

test('围栏未配平时截取最外层大括号', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n'), { a: 1 });
});

test('模型在 JSON 前后多说话也能救回来', () => {
  assert.deepEqual(parseJsonLoose('好的，结果如下：{"a":1} 希望有帮助'), { a: 1 });
});

test('解析失败返回 null 而不是抛异常', () => {
  assert.equal(parseJsonLoose('完全不是 JSON'), null);
  assert.equal(parseJsonLoose(''), null);
  assert.equal(parseJsonLoose('{坏掉的'), null);
});

test('嵌套对象的截取不会破坏结构', () => {
  const raw = '前言 {"breakdown":{"belonging":3,"bonus":-2}} 后记';
  assert.deepEqual(parseJsonLoose(raw), { breakdown: { belonging: 3, bonus: -2 } });
});
