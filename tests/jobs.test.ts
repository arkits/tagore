import { describe, expect, test } from "bun:test";
import { activeJob, JobBusyError, startJob, stopJob } from "../src/server/jobs";

type E = { t: string; id?: string; n?: number };
const opts = {
  slot: (e: E) => (e.t === "draft" ? `draft:${e.id}` : undefined),
  clears: (e: E) => (e.t === "draft-end" ? `draft:${e.id}` : undefined),
};

describe("jobs", () => {
  test("keep running after a subscriber leaves, and replay to a new one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const job = startJob<E>("t:1", async (emit) => {
      emit({ t: "a" });
      await gate;
      emit({ t: "b" });
    }, opts);
    const first: E[] = [];
    const leave = job.subscribe((e) => first.push(e), () => {});
    leave();
    release();
    await Bun.sleep(0);
    expect(first.map((e) => e.t)).toEqual(["a"]);
    const late: E[] = [];
    let ended = false;
    job.subscribe((e) => late.push(e), () => (ended = true));
    expect(late.map((e) => e.t)).toEqual(["a", "b"]);
    expect(ended).toBe(true);
    expect(activeJob("t:1")).toBeUndefined();
  });

  test("replay keeps only the latest draft and drops ended ones", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const job = startJob<E>("t:2", async (emit) => {
      emit({ t: "draft", id: "x", n: 1 });
      emit({ t: "draft", id: "y", n: 1 });
      emit({ t: "draft", id: "x", n: 2 });
      emit({ t: "draft-end", id: "y" });
      await gate;
    }, opts);
    const seen: E[] = [];
    job.subscribe((e) => seen.push(e), () => {});
    expect(seen).toEqual([{ t: "draft", id: "x", n: 2 }, { t: "draft-end", id: "y" }]);
    expect(() => startJob<E>("t:2", async () => {})).toThrow(JobBusyError);
    release();
    await Bun.sleep(0);
  });

  test("stop aborts the job's signal", async () => {
    let aborted = false;
    startJob<E>("t:3", (_emit, signal) => new Promise<void>((r) => signal.addEventListener("abort", () => { aborted = true; r(); })));
    expect(stopJob("t:3")).toBe(true);
    await Bun.sleep(0);
    expect(aborted).toBe(true);
    expect(stopJob("t:3")).toBe(false);
  });
});
