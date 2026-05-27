/**
 * news-api-server 集成测试
 * 验证关键 API 端点的行为，特别是重构后的推送路径
 */

import { describe, it, expect, mock } from "bun:test";

// Mock devicePusher.push before importing the app, so the /api/news/process
// endpoint uses the mock when renderer='device'.
import { devicePusher } from "./device-pusher.js";
const originalPush = devicePusher.push;
const pushMock = mock(async () => ({
  ok: true,
  deviceResult: "推送成功",
  pushResults: [{ device: "test-device", ok: true }],
}));
// @ts-ignore — replace method for test duration
devicePusher.push = pushMock;

const { default: app } = await import("./news-api-server.js");

describe("news-api-server endpoints", () => {
  it("GET /api/health should return healthy", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("Modular News API");
  });

  it("GET /api/news/sources should list RSS sources without pingwest", async () => {
    const res = await app.request("/api/news/sources");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);

    const allIds: string[] = [];
    for (const cat of Object.values(body.sources) as any[]) {
      for (const s of cat) {
        allIds.push(s.id);
      }
    }
    expect(allIds).not.toContain("pingwest");
    expect(allIds).toContain("solidot");
  });

  it("POST /api/news/process with mock source should succeed", async () => {
    const res = await app.request("/api/news/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "news",
        dataSource: "mock",
        processor: "passthrough",
        renderer: "news",
        index: 0,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toContain("http://localhost:29000/quote0-images/");
  });

  it("POST /api/news/process with device renderer should call devicePusher.push once", async () => {
    pushMock.mockClear();

    const res = await app.request("/api/news/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "news",
        dataSource: "mock",
        processor: "passthrough",
        renderer: "device",
        index: 1,
        context: {
          title: "Test Device Push",
          link: "https://example.com/test",
          publishTime: new Date().toISOString(),
          source: "test-source",
          category: "news",
          fingerprint: "test-fingerprint-12345",
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // The core guarantee of the refactor: devicePusher.push is called exactly once
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});

// Restore original push after all tests
describe("cleanup", () => {
  it("restore devicePusher.push", () => {
    // @ts-ignore
    devicePusher.push = originalPush;
  });
});
