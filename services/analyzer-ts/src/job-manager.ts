import { randomUUID } from "node:crypto";
import { analyze, type EmitFn } from "./analysis/engine.js";
import { cloneRepo, GitError } from "./git-ops.js";
import type { AnalysisStore } from "./store.js";
import type { AnalysisResultData } from "./models.js";

// ---------------------------------------------------------------------------
// Progress events
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  phase: string;
  progress: number;
  message: string;
  agent?: string;
  kind?: string;
  step?: number;
  stepTotal?: number;
}

// ---------------------------------------------------------------------------
// Simple semaphore
// ---------------------------------------------------------------------------

class Semaphore {
  private current = 0;
  private waiting: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.waiting.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Simple async queue for streaming
// ---------------------------------------------------------------------------

export class AsyncQueue<T> {
  private buffer: T[] = [];
  private waiting: Array<(value: T) => void> = [];
  private done = false;

  push(item: T): void {
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.buffer.push(item);
    }
  }

  end(): void {
    this.done = true;
    // Resolve any remaining waiters with a sentinel — the iterator handles this
    for (const w of this.waiting) {
      w(undefined as unknown as T);
    }
    this.waiting = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      } else if (this.done) {
        return;
      } else {
        const item = await new Promise<T>((resolve) => {
          this.waiting.push(resolve);
        });
        if (this.done && item === undefined) return;
        yield item;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Job Manager
// ---------------------------------------------------------------------------

export class JobManager {
  private sem: Semaphore;

  constructor(
    private store: AnalysisStore,
    private repoCacheDir: string,
    maxConcurrent: number,
  ) {
    this.sem = new Semaphore(Math.max(1, maxConcurrent));
  }

  async start(params: { gitUrl: string; ref: string }): Promise<string> {
    const jobId = randomUUID();
    await this.store.create({ id: jobId, gitUrl: params.gitUrl, ref: params.ref });
    // Fire and forget
    this.runJob({ jobId, gitUrl: params.gitUrl, ref: params.ref, queue: null });
    return jobId;
  }

  async startStream(params: {
    gitUrl: string;
    ref: string;
  }): Promise<{ jobId: string; queue: AsyncQueue<ProgressEvent | null> }> {
    const jobId = randomUUID();
    await this.store.create({ id: jobId, gitUrl: params.gitUrl, ref: params.ref });
    const queue = new AsyncQueue<ProgressEvent | null>();
    // Fire and forget
    this.runJob({ jobId, gitUrl: params.gitUrl, ref: params.ref, queue });
    return { jobId, queue };
  }

  private emit(
    queue: AsyncQueue<ProgressEvent | null> | null,
    phase: string,
    progress: number,
    message: string,
    opts?: { agent?: string; kind?: string; step?: number; stepTotal?: number },
  ): void {
    if (queue) {
      queue.push({
        phase,
        progress,
        message,
        agent: opts?.agent,
        kind: opts?.kind,
        step: opts?.step,
        stepTotal: opts?.stepTotal,
      });
    }
  }

  private async runJob(params: {
    jobId: string;
    gitUrl: string;
    ref: string;
    queue: AsyncQueue<ProgressEvent | null> | null;
  }): Promise<void> {
    await this.sem.acquire();
    try {
      this.emit(params.queue, "CLONE", 0.0, "Cloning repository", {
        agent: "engine",
        kind: "PHASE_START",
      });

      const repoRoot = await cloneRepo({
        gitUrl: params.gitUrl,
        ref: params.ref,
        cacheDir: this.repoCacheDir,
      });

      this.emit(params.queue, "CLONE", 0.10, "Clone complete", {
        agent: "engine",
        kind: "PHASE_END",
      });

      const emitFn: EmitFn = async (phase, progress, message, opts) => {
        this.emit(params.queue, phase, progress, message, opts);
      };

      const result: AnalysisResultData = await analyze(repoRoot, emitFn);

      this.emit(params.queue, "STORE", 0.92, "Persisting result", {
        agent: "engine",
        kind: "PHASE_START",
      });
      await this.store.setSucceeded({ id: params.jobId, result });
      this.emit(params.queue, "STORE", 0.97, "Persist complete", {
        agent: "engine",
        kind: "PHASE_END",
      });
      this.emit(params.queue, "DONE", 1.0, "Done", {
        agent: "engine",
        kind: "JOB_END",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.store.setFailed({ id: params.jobId, error: msg });
      this.emit(params.queue, "ERROR", 1.0, msg, {
        agent: "engine",
        kind: "ERROR",
      });
    } finally {
      this.sem.release();
      if (params.queue) {
        params.queue.end();
      }
    }
  }
}
