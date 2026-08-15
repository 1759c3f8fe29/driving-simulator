/**
 * ChunkStore — Bounded-concurrency, cancellable fetch+parse queue for baked
 * city chunk binaries (`assets/city/chunks/*.bin`).
 *
 * Streaming asks for far more chunks than a 2-core laptop can decode at once,
 * and it changes its mind constantly as the car moves. This module is the
 * throttle: at most `maxConcurrent` fetches are in flight, everything else
 * waits in a FIFO queue, identical requests share a single promise, and any
 * request can be cancelled whether it is queued or already downloading.
 *
 * Transient network failures get two retries (250ms then 600ms). A malformed
 * payload does not — re-downloading ~316KB to fail the same way twice more is
 * pure waste on a slow link, so parse errors reject immediately. Aborts are
 * never retried and always reject with an `AbortError`-named Error so callers
 * can filter them out of their own error handling.
 *
 * Pure data plumbing: no DOM, no THREE, no per-frame allocation beyond the one
 * task object per outstanding request.
 */

import { CityChunkEntry, chunkKey } from './CityManifest';
import { ChunkData, parseChunkBinary } from './ChunkFormat';

export type ChunkLod = 0 | 1;

/** Backoff before retry attempt N. Length also defines the retry count (2). */
const RETRY_DELAYS_MS = [250, 600];

/** Marks a decode failure so the retry loop knows not to re-download. */
class ChunkParseError extends Error {
  constructor(url: string, cause: unknown) {
    super(`ChunkStore: malformed chunk payload at ${url}: ${describe(cause)}`);
    this.name = 'ChunkParseError';
  }
}

/** Marks a 4xx response: the file is not there, so retrying cannot help. */
class ChunkNotFoundError extends Error {
  constructor(url: string, status: number, statusText: string) {
    super(`ChunkStore: ${url} returned HTTP ${status} ${statusText}`);
    this.name = 'ChunkNotFoundError';
  }
}

interface ChunkTask {
  key: string;
  url: string;
  controller: AbortController;
  promise: Promise<ChunkData>;
  resolve: (data: ChunkData) => void;
  reject: (err: Error) => void;
  /** True once pump() has handed the task to run(); run()'s finally re-pumps it. */
  started: boolean;
  settled: boolean;
  /** Live backoff timer, cleared on cancel so dispose leaves nothing dangling. */
  timer: ReturnType<typeof setTimeout> | null;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Duck-typed on purpose: a native fetch abort throws a DOMException, which does
 * not inherit from Error in browsers, so `instanceof Error` would miss it and
 * the retry loop would re-download a chunk the streamer already dropped.
 */
function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function makeAbortError(url: string): Error {
  const err = new Error(`ChunkStore: request aborted for ${url}`);
  err.name = 'AbortError';
  return err;
}

export class ChunkStore {
  private readonly baseUrl: string;
  private readonly maxConcurrent: number;
  /** Every outstanding request, keyed `cx,cz:lod` — the dedupe index. */
  private readonly tasks = new Map<string, ChunkTask>();
  /** FIFO of tasks not yet started. */
  private readonly queue: ChunkTask[] = [];
  private active = 0;
  private disposed = false;

  constructor(baseUrl: string, maxConcurrent: number) {
    // Manifest paths are relative to the city base dir, so guarantee the join.
    this.baseUrl = baseUrl.length > 0 && !baseUrl.endsWith('/') ? `${baseUrl}/` : baseUrl;
    // Guard NaN as well as 0/negative: Math.max(1, NaN) is NaN, which would
    // make the pump condition permanently false and stall every load.
    this.maxConcurrent = Number.isFinite(maxConcurrent) ? Math.max(1, Math.floor(maxConcurrent)) : 1;
  }

  get pending(): number {
    return this.queue.length;
  }

  get inFlight(): number {
    return this.active;
  }

  /**
   * Queue (or join) a load for one chunk at one LOD. A chunk with no baked
   * LOD1 transparently falls back to its LOD0 file.
   */
  request(entry: CityChunkEntry, lod: ChunkLod): Promise<ChunkData> {
    const relative = lod === 1 && entry.lod1 ? entry.lod1 : entry.file;
    const url = this.baseUrl + relative;
    if (this.disposed) {
      return Promise.reject(new Error(`ChunkStore: disposed, refusing request for ${url}`));
    }

    const key = `${chunkKey(entry.cx, entry.cz)}:${lod}`;
    const existing = this.tasks.get(key);
    if (existing) return existing.promise;

    let resolve: (data: ChunkData) => void = () => {};
    let reject: (err: Error) => void = () => {};
    const promise = new Promise<ChunkData>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: ChunkTask = {
      key,
      url,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      started: false,
      settled: false,
      timer: null,
    };
    this.tasks.set(key, task);
    this.queue.push(task);
    this.pump();
    return promise;
  }

  /** Abort an in-flight load or drop a queued one. Its promise rejects with an AbortError. */
  cancel(entry: CityChunkEntry, lod: ChunkLod): void {
    const task = this.tasks.get(`${chunkKey(entry.cx, entry.cz)}:${lod}`);
    if (task) this.abortTask(task);
  }

  /** Abort every outstanding request; the store stays usable afterwards. */
  cancelAll(): void {
    for (const task of Array.from(this.tasks.values())) this.abortTask(task);
    this.queue.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    this.queue.length = 0;
    this.tasks.clear();
  }

  /**
   * Start work while there is capacity. Called on enqueue, on every settle,
   * and after a queued task is dropped — never on a timer.
   */
  private pump(): void {
    while (!this.disposed && this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      if (task.settled) continue; // cancelled between enqueue and pump
      task.started = true;
      this.active++;
      void this.run(task);
    }
  }

  private async run(task: ChunkTask): Promise<void> {
    try {
      const data = await this.load(task);
      // A cancel that lands after the body was read but before we settle must
      // still reject, so callers never get geometry for a chunk they dropped.
      if (task.controller.signal.aborted) {
        this.settle(task, makeAbortError(task.url), null);
      } else {
        this.settle(task, null, data);
      }
    } catch (err) {
      this.settle(task, err instanceof Error ? err : new Error(describe(err)), null);
    } finally {
      this.active--;
      this.pump();
    }
  }

  private async load(task: ChunkTask): Promise<ChunkData> {
    let lastError: unknown = null;
    const attempts = RETRY_DELAYS_MS.length + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (task.controller.signal.aborted) throw makeAbortError(task.url);
      try {
        const res = await fetch(task.url, { signal: task.controller.signal });
        if (!res.ok) {
          // 4xx means the bake never wrote this file; only 5xx/network is transient.
          if (res.status >= 400 && res.status < 500) {
            throw new ChunkNotFoundError(task.url, res.status, res.statusText);
          }
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const buffer = await res.arrayBuffer();
        try {
          return parseChunkBinary(buffer);
        } catch (parseErr) {
          throw new ChunkParseError(task.url, parseErr);
        }
      } catch (err) {
        if (isAbortError(err) || task.controller.signal.aborted) throw makeAbortError(task.url);
        if (err instanceof ChunkParseError || err instanceof ChunkNotFoundError) throw err;
        lastError = err;
        // No delay left => that was the final attempt; fall through to the throw.
        if (attempt >= RETRY_DELAYS_MS.length) break;
        await this.backoff(task, RETRY_DELAYS_MS[attempt]);
        if (task.controller.signal.aborted) throw makeAbortError(task.url);
      }
    }

    throw new Error(
      `ChunkStore: failed to load ${task.url} after ${attempts} attempts: ${describe(lastError)}`
    );
  }

  /** Sleep, but wake immediately if the task is cancelled mid-backoff. */
  private backoff(task: ChunkTask, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const signal = task.controller.signal;
      const done = (): void => {
        if (task.timer !== null) {
          clearTimeout(task.timer);
          task.timer = null;
        }
        signal.removeEventListener('abort', done);
        resolve();
      };
      task.timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });
  }

  private abortTask(task: ChunkTask): void {
    const queuedAt = this.queue.indexOf(task);
    if (queuedAt >= 0) this.queue.splice(queuedAt, 1);
    if (task.timer !== null) {
      clearTimeout(task.timer);
      task.timer = null;
    }
    // Drop the dedupe entry now, not at settle: the car can reverse and ask for
    // this chunk again immediately, and it must get a fresh fetch rather than
    // join the promise we just doomed.
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
    task.controller.abort();
    if (!task.started) {
      // Never reached run(), so nothing else will settle it or re-pump.
      this.settle(task, makeAbortError(task.url), null);
      this.pump();
    }
  }

  private settle(task: ChunkTask, err: Error | null, data: ChunkData | null): void {
    if (task.settled) return;
    task.settled = true;
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
    if (err) {
      task.reject(err);
    } else if (data) {
      task.resolve(data);
    } else {
      task.reject(new Error(`ChunkStore: internal error, no result for ${task.url}`));
    }
  }
}
