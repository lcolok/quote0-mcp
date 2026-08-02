/**
 * DevicePusher 单元测试
 * 验证统一推送层的职责：Renderer 只生成图片，推送只发生一次
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { writeFile, unlink } from "fs/promises";

const TEMP_PNG = "/tmp/device-pusher-test.png";
let lastExecCommand = "";
let mockEinkDevices: Array<{ id: string; name: string; baseUrl: string; token: string; width: number; height: number }> = [];
const getEinkDevicesMock = mock(async (options?: { deviceIds?: string[] }) => {
  if (!options?.deviceIds) return mockEinkDevices;
  return mockEinkDevices.filter((device) => options.deviceIds!.includes(device.id));
});
const pushToEinkDeviceMock = mock(async () => ({ ok: true }));
const resolveEinkDeviceSpecMock = mock(async (device: any) => device);
const resolveEinkDeviceSpecWithStatusMock = mock(async (device: any) => ({ device, status: undefined }));

mock.module("child_process", () => ({
  execFile: (cmd: string, args: string[], optionsOrCb: any, maybeCb?: any) => {
    lastExecCommand = [cmd, ...args].join(' ');
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    if (cb) cb(null, "stdout", "");
  },
}));

mock.module("./eink-converter.js", () => ({
  pngTo1BitBitmap: mock(async () => Buffer.from("bitmap")),
  getEinkDevices: getEinkDevicesMock,
  resolveEinkDeviceSpec: resolveEinkDeviceSpecMock,
  resolveEinkDeviceSpecWithStatus: resolveEinkDeviceSpecWithStatusMock,
  pushToEinkDevice: pushToEinkDeviceMock,
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
    mockEinkDevices = [];
    getEinkDevicesMock.mockClear();
    pushToEinkDeviceMock.mockClear();
    resolveEinkDeviceSpecMock.mockClear();
    resolveEinkDeviceSpecWithStatusMock.mockClear();
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

    it("should forward selected device ids and push only to that device", async () => {
      mockEinkDevices = [
        { id: "eink-1", name: "客厅墨水屏", baseUrl: "http://192.168.31.37", token: "token-1", width: 296, height: 152 },
        { id: "eink-2", name: "S3自制板墨水屏", baseUrl: "http://192.168.31.38", token: "token-2", width: 296, height: 152 },
      ];

      const result = await pusher.push(TEMP_PNG, "local-eink", { deviceIds: ["eink-2"] });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("success");
      expect(result.pushResults).toHaveLength(1);
      expect(result.pushResults![0]).toMatchObject({ device: "eink-2", deviceId: "eink-2", ok: true, error: undefined });
      expect(getEinkDevicesMock).toHaveBeenCalledWith({ deviceIds: ["eink-2"] });
      expect(pushToEinkDeviceMock).toHaveBeenCalledTimes(1);
    });
  });
});
