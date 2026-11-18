/**
 * Server-owned background jobs (agent runs, chapter summaries).
 *
 * A job runs independently of the HTTP request that started it: closing or refreshing the page only
 * detaches that viewer. Every event is kept in the job's log so a client that (re)attaches gets the
 * full state replayed, then follows live. Only one job per key (e.g. `agent:<chapterId>`) runs at a time.
 */

export type JobOptions<E> = {
  /**
   * Events that only matter in their latest form (streaming previews, progress counters) share a slot:
   * a new event with the same key replaces the old one in the replay log, so the log stays small.
   */
  slot?: (e: E) => string | undefined;
  /** Slots this event retires (e.g. a draft that has ended); their entries are dropped from the log. */
  clears?: (e: E) => string | undefined;
};

export class Job<E> {
  readonly startedAt = Date.now();
  readonly controller = new AbortController();
  done = false;
  private log: (E | undefined)[] = [];
  private slots = new Map<string, number>();
  private subscribers = new Set<{ push: (e: E) => void; end: () => void }>();

  constructor(
    readonly key: string,
    private opts: JobOptions<E> = {},
  ) {}

  get signal() {
    return this.controller.signal;
  }

  emit = (e: E) => {
    if (this.done) return;
    const cleared = this.opts.clears?.(e);
    if (cleared !== undefined) {
      const i = this.slots.get(cleared);
      if (i !== undefined) this.log[i] = undefined;
      this.slots.delete(cleared);
    }
    const slot = this.opts.slot?.(e);
    if (slot !== undefined) {
      const prev = this.slots.get(slot);
      if (prev !== undefined) this.log[prev] = undefined;
      this.slots.set(slot, this.log.length);
    }
    this.log.push(e);
    for (const s of this.subscribers) s.push(e);
  };

  finish() {
    if (this.done) return;
    this.done = true;
    for (const s of this.subscribers) s.end();
    this.subscribers.clear();
  }

  /** Replay everything so far, then follow live until the job ends or the caller unsubscribes. */
  subscribe(push: (e: E) => void, end: () => void): () => void {
    for (const e of this.log) if (e !== undefined) push(e);
    if (this.done) {
      end();
      return () => {};
    }
    const sub = { push, end };
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  /** Stream the job to an HTTP client. Disconnecting detaches the client; the job keeps running. */
  stream(encode: (e: E) => string, signal?: AbortSignal): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let unsubscribe = () => {};
    return new ReadableStream({
      start: (controller) => {
        const close = () => {
          unsubscribe();
          try {
            controller.close();
          } catch {}
        };
        unsubscribe = this.subscribe(
          (e) => {
            try {
              controller.enqueue(enc.encode(encode(e)));
            } catch {
              unsubscribe();
            }
          },
          close,
        );
        signal?.addEventListener("abort", close, { once: true });
      },
      cancel: () => unsubscribe(),
    });
  }
}

const jobs = new Map<string, Job<any>>();

export class JobBusyError extends Error {}

/** Start a job under `key`. `run` gets the job's emit and signal; errors are passed to `onError`. */
export function startJob<E>(
  key: string,
  run: (emit: (e: E) => void, signal: AbortSignal) => Promise<void>,
  opts: JobOptions<E> & { onError?: (err: unknown, job: Job<E>) => void } = {},
): Job<E> {
  if (jobs.get(key)?.done === false) throw new JobBusyError("Already running.");
  const job = new Job<E>(key, opts);
  jobs.set(key, job);
  void (async () => {
    try {
      await run(job.emit, job.signal);
    } catch (err) {
      opts.onError?.(err, job);
    } finally {
      job.finish();
      if (jobs.get(key) === job) jobs.delete(key);
    }
  })();
  return job;
}

/** The job currently running under `key`, if any. */
export function activeJob<E>(key: string): Job<E> | undefined {
  const job = jobs.get(key);
  return job && !job.done ? job : undefined;
}

export function stopJob(key: string): boolean {
  const job = activeJob(key);
  if (!job) return false;
  job.controller.abort();
  return true;
}
