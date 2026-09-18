#!/usr/bin/env node
/**
 * SSE 抓包体检 CLI —— 把 sse-capture-proxy 录到的字节流判定根因。
 *
 * 用法：
 *   node --import tsx tools/sse-inspect-cli.ts captures/capture-xxx.jsonl
 *   node --import tsx tools/sse-inspect-cli.ts captures/capture-xxx.jsonl --expect "期望的正确文本"
 *   node --import tsx tools/sse-inspect-cli.ts captures/capture-xxx.jsonl --dump   # 打印每帧原文
 *
 * 判定逻辑全部复用 tools/sse-inspector.ts —— 该模块已通过元测试
 * （用 6 个已知根因的注入场景验证过判定正确性，见 tests/sse-inspector.test.ts）。
 */
import fs from 'fs';
import { parseSseStream, diagnose, renderReport } from './sse-inspector';

interface CaptureRecord {
  t: string;
  atMs: number;
  text?: string;
  meta?: Record<string, unknown>;
}

function readCapture(file: string): { chunks: { atMs: number; text: string }[]; records: CaptureRecord[] } {
  const raw = fs.readFileSync(file, 'utf8');
  const records: CaptureRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* 跳过损坏行 */ }
  }
  const chunks = records
    .filter(r => r.t === 'chunk' && typeof r.text === 'string')
    .map(r => ({ atMs: r.atMs, text: r.text as string }));
  return { chunks, records };
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--'));
  const expectIdx = argv.indexOf('--expect');
  const expectedText = expectIdx >= 0 ? argv[expectIdx + 1] : undefined;
  const dump = argv.includes('--dump');
  const gapIdx = argv.indexOf('--gap-ms');
  const gapThresholdMs = gapIdx >= 0 ? Number(argv[gapIdx + 1]) : 3_000;

  if (!file) {
    console.error('用法: node --import tsx tools/sse-inspect-cli.ts <capture.jsonl> [--expect "文本"] [--dump] [--gap-ms 3000]');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`找不到文件: ${file}`);
    process.exit(2);
  }

  const { chunks, records } = readCapture(file);
  if (chunks.length === 0) {
    console.error('该抓包中没有 chunk 记录。确认客户端请求确实走了代理？');
    process.exit(2);
  }

  const parsed = parseSseStream(chunks, { expectedText, gapThresholdMs });

  // ── 抓包元信息 ──
  const req = records.find(r => r.t === 'request');
  const head = records.find(r => r.t === 'response-head');
  const end = records.find(r => r.t === 'end');

  console.log('════════ 抓包元信息 ════════');
  if (req) {
    console.log(`上游请求  : ${req.meta?.method} ${req.meta?.url}`);
    console.log(`请求体字节: ${req.meta?.bodyBytes}`);
  }
  if (head) console.log(`响应状态  : ${head.meta?.status}`);
  if (end) {
    console.log(`TTFB      : ${end.meta?.ttfbMs}ms`);
    console.log(`总耗时    : ${end.meta?.totalMs}ms`);
    console.log(`chunk 数  : ${end.meta?.chunkCount}`);
  }
  console.log('');

  if (dump) {
    console.log('════════ 逐帧原文（前 40 帧）════════');
    parsed.frames.slice(0, 40).forEach(f => {
      const tag = f.isComment ? '[注释]' : `[data]`;
      console.log(`#${String(f.arrivalIndex).padStart(3)} @${String(f.atMs).padStart(6)}ms id=${f.id ?? '-'} ${tag} ${JSON.stringify(f.data).slice(0, 160)}`);
    });
    console.log('');
  }

  console.log(renderReport(diagnose(parsed), parsed));

  // ── 无 --expect 时的提示 ──
  if (expectedText === undefined) {
    console.log('');
    console.log('⚠️ 未提供 --expect，因此无法做「内容损坏 vs 顺序错乱」的判别。');
    console.log('   该判别需要知道「正确文本应该是什么」。建议：');
    console.log('   1. 从上游响应或模型输出里拿到正确文本（同一 prompt 重跑一次通常可得）');
    console.log('   2. 重新运行并加 --expect "…"');
  }
}

main();
