#!/usr/bin/env node
/**
 * SSE 抓包代理 —— 把你和上游 LLM 之间的原始字节流录下来。
 *
 * ┌─ 用法 ─────────────────────────────────────────────────────┐
 * │ 1. 启动代理：                                              │
 * │      node --import tsx tools/sse-capture-proxy.ts          │
 * │    （默认监听 8787，转发到 https://api.deepseek.com）       │
 * │                                                            │
 * │ 2. 让客户端把 baseURL 指向代理，而不是直连上游：            │
 * │      http://127.0.0.1:8787                                 │
 * │                                                            │
 * │ 3. 复现问题，然后 Ctrl-C。日志落在 captures/ 下。           │
 * │                                                            │
 * │ 4. 体检：                                                   │
 * │      node --import tsx tools/sse-inspect-cli.ts captures/xx.jsonl │
 * └────────────────────────────────────────────────────────────┘
 *
 * 设计要点（决定了这份数据能不能用来定根因）：
 *   · **不改动上游协议**：请求与响应都原样透传，只做旁路记录
 *   · **记录到达时间戳**：没有时序就无法判断「挂起」与「重排」
 *   · **记录原始字节**：不做任何解析或重编码，避免把工具自身的 bug 引入数据
 *   · **按 chunk 落盘**：保留 TCP 分片边界 —— 这正是「帧被切断」的证据
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.CAPTURE_PORT || 8787);
const UPSTREAM = process.env.UPSTREAM_BASE || 'https://api.deepseek.com';
const OUT_DIR = process.env.CAPTURE_DIR || 'captures';

const upstreamUrl = new URL(UPSTREAM);
const outDirAbs = path.resolve(process.cwd(), OUT_DIR);
fs.mkdirSync(outDirAbs, { recursive: true });

interface CaptureRecord {
  t: 'request' | 'response-head' | 'chunk' | 'end' | 'error';
  atMs: number;
  /** chunk 事件携带的原始文本 */
  text?: string;
  meta?: Record<string, unknown>;
}

function newCaptureFile(): { stream: fs.WriteStream; file: string } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDirAbs, `capture-${stamp}.jsonl`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  return { stream, file };
}

const server = http.createServer((clientReq, clientRes) => {
  const startedAt = performance.now();
  const { stream: log, file } = newCaptureFile();
  const rel = (t: number) => Math.round(t - startedAt);

  const write = (rec: CaptureRecord) => log.write(`${JSON.stringify(rec)}\n`);

  const reqChunks: Buffer[] = [];
  clientReq.on('data', c => reqChunks.push(c));
  clientReq.on('end', () => {
    const body = Buffer.concat(reqChunks);
    write({
      t: 'request',
      atMs: rel(performance.now()),
      meta: {
        method: clientReq.method,
        url: clientReq.url,
        headers: clientReq.headers,
        bodyPreview: body.toString('utf8').slice(0, 2000),
        bodyBytes: body.length,
      },
    });

    const target = new URL(clientReq.url || '/', upstreamUrl);
    const headers = { ...clientReq.headers, host: upstreamUrl.host };

    const upstreamReq = https.request(
      {
        protocol: upstreamUrl.protocol,
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || 443,
        path: target.pathname + target.search,
        method: clientReq.method,
        headers,
      },
      upstreamRes => {
        write({
          t: 'response-head',
          atMs: rel(performance.now()),
          meta: {
            status: upstreamRes.statusCode,
            headers: upstreamRes.headers,
          },
        });

        // 原样透传响应头与状态
        clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);

        let firstByteAt: number | null = null;
        let chunkCount = 0;

        upstreamRes.on('data', (c: Buffer) => {
          const now = performance.now();
          if (firstByteAt === null) {
            firstByteAt = now;
            write({ t: 'chunk', atMs: rel(now), meta: { first: true, ttfbMs: Math.round(now - startedAt) } });
          }
          chunkCount += 1;
          // 记录原始字节：decode 时不丢跨 chunk 的多字节字符
          write({
            t: 'chunk',
            atMs: rel(now),
            text: c.toString('utf8'),
            meta: { bytes: c.length, index: chunkCount },
          });
          clientRes.write(c);   // 原样转发，零改动
        });

        upstreamRes.on('end', () => {
          write({
            t: 'end',
            atMs: rel(performance.now()),
            meta: {
              chunkCount,
              totalMs: Math.round(performance.now() - startedAt),
              ttfbMs: firstByteAt ? Math.round(firstByteAt - startedAt) : null,
            },
          });
          clientRes.end();
          log.end();
          console.log(`✔ 已保存 ${path.relative(process.cwd(), file)}（${chunkCount} 个 chunk）`);
        });
      },
    );

    upstreamReq.on('error', err => {
      write({ t: 'error', atMs: rel(performance.now()), meta: { message: String(err) } });
      log.end();
      if (!clientRes.headersSent) clientRes.writeHead(502, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: { message: `上游连接失败: ${err.message}` } }));
      console.error(`✘ 上游错误: ${err.message}`);
    });

    upstreamReq.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SSE 抓包代理已启动`);
  console.log(`  监听      : http://127.0.0.1:${PORT}`);
  console.log(`  上游      : ${UPSTREAM}`);
  console.log(`  日志目录  : ${path.relative(process.cwd(), outDirAbs)}/`);
  console.log('');
  console.log(`把客户端的 baseURL 指向 http://127.0.0.1:${PORT} 即可开始录制。`);
  console.log(`注意：代理不做 TLS，若客户端强制 https 需自行加证书。`);
});
