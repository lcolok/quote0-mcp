import { describe, it, expect, mock } from "bun:test";
import { writeFile, unlink } from "node:fs/promises";

const TEMP_PNG = "/tmp/retry-test.png";
let callCount = 0;

mock.module("child_process", () => ({
  execFile: (cmd: string, args: string[], optionsOrCb: any, maybeCb?: any) => {
    callCount++;
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    if (callCount < 3) {
      if (cb) cb(new Error("429 Too Many Requests"), "", "");
    } else {
      if (cb) cb(null, "stdout", "");
    }
  },
}));

// Use cache-busting import so mock.module takes effect
const { DevicePusher } = await import("./device-pusher.js?" + Date.now());

describe("DevicePusher 429 retry", () => {
  it("should retry on 429 and succeed on 3rd attempt", async () => {
    await writeFile(TEMP_PNG, Buffer.from("fake-png"));
    callCount = 0;
    const pusher = new DevicePusher({ retryDelayMs: 10 });
    try {
      const result = await pusher.push(TEMP_PNG, "device");
      expect(result.ok).toBe(true);
      expect(callCount).toBe(3);
    } finally {
      await unlink(TEMP_PNG);
    }
  });
});
