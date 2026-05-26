/**
 * DevicePusher 单元测试
 * 验证统一推送层的职责：Renderer 只生成图片，推送只发生一次
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { writeFile, unlink } from "fs/promises";

const TEMP_PNG = "/tmp/device-pusher-test.png";
let lastExecCommand = "";

mock.module("child_process", () => ({
  exec: (...args: any[]) => {
    lastExecCommand = args[0];
    const cb = args.find((a: any) => typeof a === "function");
    if (cb) cb(null, "stdout", "");
  },
}));

mock.module("./eink-converter.js", () => ({
  pngTo1BitBitmap: mock(async () => Buffer.from("bitmap")),
  getEinkDevices: mock(async () => []),
  pushToEinkDevice: mock(async () => ({ ok: true })),
}));

// Use cache-busting dynamic import so mock.module takes effect even when
// device-pusher.js was already loaded by another test file.
const devicePusherModule = await import("./device-pusher.js?" + Date.now());
const DevicePusher = devicePusherModule.DevicePusher;

describe("DevicePusher", () => {
  const pusher = new DevicePusher();

  beforeEach(async () => {
    await writeFile(TEMP_PNG, Buffer.from("fake-png-data"));
    lastExecCommand = "";
  });

  afterEach(async () => {
    try {
      await unlink(TEMP_PNG);
    } catch {}
  });

  describe("pushToMindReset (device renderer)", () => {
    it("should execute MindReset CLI with local file path", async () => {
      const result = await pusher.push(TEMP_PNG, "device");

      expect(result.ok).toBe(true);
      expect(result.deviceResult).toBe("推送成功");
      expect(lastExecCommand).toContain("send-server-dither");
      expect(lastExecCommand).toContain(TEMP_PNG);
    });
  });

  describe("pushToLocalEink (local-eink renderer)", () => {
    it("should fail gracefully when no e-ink devices configured", async () => {
      const result = await pusher.push(TEMP_PNG, "local-eink");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("未配置");
    });
  });

  describe("push (public API dispatch)", () => {
    it("should dispatch to MindReset for device renderer", async () => {
      const result = await pusher.push(TEMP_PNG, "device");
      expect(result.ok).toBe(true);
      expect(lastExecCommand).toContain("cli-main.ts");
    });

    it("should dispatch to ESP32 path for local-eink renderer", async () => {
      const result = await pusher.push(TEMP_PNG, "local-eink");
      expect(result).toHaveProperty("ok");
      expect(result.error).toContain("未配置");
    });
  });
});
