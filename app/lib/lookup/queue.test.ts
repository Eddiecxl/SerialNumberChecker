import { describe, expect, it } from "vitest";
import { LookupQueue } from "./queue";

const items = ["A123456", "B123456", "C123456", "D123456"].map((serial) => ({
  serialNumber: serial,
  normalizedSerial: serial,
}));

describe("LookupQueue", () => {
  it("never exceeds the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const queue = new LookupQueue({
      items,
      concurrency: 2,
      lookup: async (serial) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return serial;
      },
    });
    await queue.start();
    expect(peak).toBe(2);
  });

  it("looks up a normalized serial once and reuses it for duplicates", async () => {
    let calls = 0;
    const queue = new LookupQueue({
      items: [
        { serialNumber: "5cg-1234-abc", normalizedSerial: "5CG1234ABC" },
        { serialNumber: "5CG1234ABC", normalizedSerial: "5CG1234ABC" },
      ],
      lookup: async () => { calls += 1; return { cpu: "i5" }; },
    });
    const results = await queue.start();
    expect(calls).toBe(1);
    expect(results.get("5CG1234ABC")?.data).toEqual({ cpu: "i5" });
    expect(queue.progress.duplicatesReused).toBe(1);
  });

  it("retries transient failures but isolates a permanent row failure", async () => {
    const attempts = new Map<string, number>();
    const queue = new LookupQueue({
      items: items.slice(0, 2),
      maxAttempts: 3,
      backoffMs: 0,
      lookup: async (serial) => {
        const attempt = (attempts.get(serial) ?? 0) + 1;
        attempts.set(serial, attempt);
        if (serial === "A123456" && attempt < 3) throw Object.assign(new Error("busy"), { transient: true });
        if (serial === "B123456") throw new Error("not found");
        return serial;
      },
    });
    const results = await queue.start();
    expect(results.get("A123456")).toMatchObject({ status: "success", attempts: 3 });
    expect(results.get("B123456")).toMatchObject({ status: "error", attempts: 1 });
    expect(queue.progress.completed).toBe(2);
  });

  it("does not start work while paused and resumes the same batch", async () => {
    let calls = 0;
    const queue = new LookupQueue({ items: items.slice(0, 1), lookup: async () => { calls += 1; return "ok"; } });
    queue.pause();
    const running = queue.start();
    await Promise.resolve();
    expect(calls).toBe(0);
    queue.resume();
    await running;
    expect(calls).toBe(1);
  });

  it("can retry one failed serial without restarting successful work", async () => {
    let calls = 0;
    const queue = new LookupQueue({
      items: items.slice(0, 1),
      lookup: async () => {
        calls += 1;
        if (calls === 1) throw new Error("first failure");
        return "recovered";
      },
    });
    await queue.start();
    const result = await queue.retry("A123456");
    expect(result).toMatchObject({ status: "success", data: "recovered" });
    expect(calls).toBe(2);
  });
});
