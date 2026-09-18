/**
 * 纯函数流式解码层 —— 无 React、无网络、无副作用。
 *
 * 单独成文件的原因：LLM 供应商的流式分片会出现
 * 「生成顺序 / 完成顺序 / 消费顺序」三者不一致（典型现象：
 * 后发分片先到、usage-only 空 delta 帧、一次 SSE 事件里塞多条 data: 行、
 * 末帧先于倒数第二帧被消费）。把这些判定抽成纯函数，
 * 就能在不打真实 API 的前提下覆盖这些回归场景。
 */

/** 一个流式分片的最小信息 */
export interface ChunkFrame {
  /**
   * 生成序位（0-based）。由消费侧按 SSE 事件出现顺序编号 ——
   * 不要用 choices[].index，那是「第几个候选」，单选场景恒为 0。
   */
  seq: number;
  /** 本分片携带的增量文本，可能为空（如 usage-only 帧） */
  text: string;
  /** 是否为终止帧（finish_reason 非空 / [DONE]） */
  finish?: boolean;
}

/** 一次消费动作的判定结果 */
export interface GuardRelease {
  /** 此刻可以安全按序拼接的分片文本 */
  text: string;
  /** 被挂起、等待前序补齐的分片数 */
  buffered: number;
  /** 是否检测到乱序（有分片被挂起过） */
  reordered: boolean;
}

/**
 * 消费顺序守卫。
 *
 * 设计目标：即使分片乱序到达，拼接出的文本也必须等于生成顺序的文本。
 *
 * 与首版设计的区别：不允许「等待空洞补齐」无限阻塞。
 * 若某个前序分片永远丢失（供应商丢帧），守卫必须在超时后放行，
 * 否则玩家会看到消息卡死。因此 release 接受 `force` —— 由调用方
 * 在超时或流结束时强制冲空，保证「要么有序、要么完整」。
 */
export class ChunkOrderGuard {
  private nextSeq = 0;
  private pending = new Map<number, ChunkFrame>();
  private sawReordering = false;

  /** 送入一个分片，返回此刻可消费的部分 */
  push(frame: ChunkFrame): GuardRelease {
    if (frame.seq < this.nextSeq) {
      // 迟到分片：已经被超时冲空消费过，直接丢弃，避免重复拼接
      return { text: '', buffered: this.pending.size, reordered: true };
    }
    if (frame.seq > this.nextSeq) {
      // 跳跃：挂起，等前序。同时记录乱序事实
      this.sawReordering = true;
      this.pending.set(frame.seq, frame);
      return { text: '', buffered: this.pending.size, reordered: true };
    }

    // seq === nextSeq，按序放行，并继续吃后续连续分片
    let out = frame.text;
    this.nextSeq += 1;
    while (this.pending.has(this.nextSeq)) {
      const next = this.pending.get(this.nextSeq)!;
      this.pending.delete(this.nextSeq);
      out += next.text;
      this.nextSeq += 1;
    }
    return { text: out, buffered: this.pending.size, reordered: this.sawReordering };
  }

  /**
   * 强制冲空：按 seq 升序取出所有挂起分片。
   * 用于「前序分片已被判定丢失」或「流已结束但仍有残留」的兜底。
   */
  flush(): GuardRelease {
    const queued = [...this.pending.entries()].sort((a, b) => a[0] - b[0]);
    this.pending.clear();
    let out = '';
    for (const [seq, frame] of queued) {
      out += frame.text;
      this.nextSeq = Math.max(this.nextSeq, seq + 1);
    }
    const reordered = this.sawReordering;
    this.sawReordering = false;
    return { text: out, buffered: 0, reordered };
  }

  /** 尚未补齐的序位，用于诊断日志 */
  pendingSeqs(): number[] {
    return [...this.pending.keys()].sort((a, b) => a - b);
  }

  get hasGap(): boolean {
    return this.pending.size > 0;
  }

  reset(): void {
    this.nextSeq = 0;
    this.pending.clear();
    this.sawReordering = false;
  }
}

/**
 * 按出现顺序给分片编号，再交给守卫。
 * 这是消费侧唯一正确的编号来源。
 */
export class SequencedConsumer {
  private seq = 0;
  private guard = new ChunkOrderGuard();
  private outOfOrderFrames = 0;

  /** 消费一个原始分片（已由 extractDeltaFrame 解出） */
  consume(text: string, finish = false): GuardRelease {
    const release = this.guard.push({ seq: this.seq++, text, finish });
    if (release.reordered) this.outOfOrderFrames += 1;
    return release;
  }

  /** 流结束时冲空残留分片 */
  drain(): GuardRelease {
    return this.guard.flush();
  }

  /** 本次流中被挂起过的分片数（>0 说明供应商确实乱序了） */
  get reorderCount(): number {
    return this.outOfOrderFrames;
  }
}

/** 从 OpenAI 兼容的非流式响应体里取出文本 */
export function extractCompletionText(payload: unknown): string {
  const choice = (payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : '';
}

/** 从 OpenAI 兼容的流式分片里取出增量文本与终止标记 */
export function extractDeltaFrame(chunk: unknown): { text: string; finish: boolean } {
  const c = chunk as {
    choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[];
  } | null;

  const choice = c?.choices?.[0];
  const raw = choice?.delta?.content;
  const text = typeof raw === 'string' ? raw : '';
  return { text, finish: choice?.finish_reason != null };
}

/**
 * 把可能包含 ```json 围栏、BOM、前后空白，或围栏未配平的字符串
 * 解析成 JSON。失败返回 null，由调用方决定是否重试。
 */
export function parseJsonLoose(raw: string): any | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    /* 落到下面的括号截取 */
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}
