/**
 * 渲染模块单元测试
 * 验证 Renderer 职责边界：只渲染/上传，不推送
 */

import { describe, it, expect, mock } from "bun:test";

// Mock Satori 相关依赖，避免加载真实字体
mock.module("../components/SatoriNewsWidget.js", () => ({
  SatoriNewsWidget: () => null,
}));

mock.module("./satori-renderer.js", () => ({
  satoriRenderer: {
    initialize: mock(async () => {}),
    renderToImage: mock(async () => Buffer.from("fake-png")),
  },
}));

mock.module("./image-storage.js", () => ({
  getImageStorage: () => ({
    uploadImage: mock(async () => ({
      url: "http://minio/quote0-images/widgets/news/test.png",
      objectKey: "widgets/news/test.png",
    })),
  }),
}));

// 在 mock 之后导入被测模块
const { DevicePushRenderingModule, LocalEinkRenderingModule } = await import(
  "./rendering-modules.js"
);

describe("DevicePushRenderingModule", () => {
  const renderer = new DevicePushRenderingModule();

  describe("transformToRenderable", () => {
    it("should transform processed data to renderable format", () => {
      const result = renderer.transformToRenderable(
        {
          optimizedTitle: "测试标题",
          summary: "测试摘要",
          rawData: { source: "rss", publishTime: "2026-05-27T10:00:00Z" },
          processingMetadata: { processor: "ax-optimized" },
          qualityScore: 0.92,
        } as any,
        {}
      );

      expect(result.title).toBe("测试标题");
      expect(result.message).toBe("测试摘要");
      expect(result.source).toBe("rss");
      // 'ax-optimized' 不包含大写 'AX'，因此会走 else 分支返回 "RSS智能"
      expect(result.signature).toBe("RSS智能");
    });
  });

  describe("render", () => {
    it("should return image metadata without deviceResult (no pushing)", async () => {
      const result = await renderer.render(
        {
          id: "test-1",
          title: "Test News",
          message: "Test content",
          signature: "AI优化·Q92",
          source: "solidot",
          publishTime: "2026-05-27T10:00:00Z",
          category: "technology",
          link: "https://example.com",
          highlights: [],
        } as any,
        { border: "0" }
      );

      expect(result).toHaveProperty("imageUrl");
      expect(result).toHaveProperty("localImagePath");
      expect(result).toHaveProperty("title", "Test News");
      expect(result).toHaveProperty("message", "Test content");
      // 关键断言：Renderer 不再返回 deviceResult
      expect(result).not.toHaveProperty("deviceResult");
      // 关键断言：localImagePath 是真实本地路径，不是 /objectKey 格式
      expect(result.localImagePath).toStartWith("./processed-images/");
    });
  });
});

describe("LocalEinkRenderingModule", () => {
  const renderer = new LocalEinkRenderingModule();

  describe("render", () => {
    it("should return image metadata without pushResults (no pushing)", async () => {
      const result = await renderer.render(
        {
          id: "test-2",
          title: "EInk Test",
          message: "EInk content",
          signature: "RSS智能",
          source: "solidot",
          publishTime: "2026-05-27T10:00:00Z",
          category: "technology",
          link: "https://example.com",
          highlights: [],
        } as any,
        { border: "0" }
      );

      expect(result).toHaveProperty("imageUrl");
      expect(result).toHaveProperty("localImagePath");
      expect(result).toHaveProperty("title", "EInk Test");
      // 关键断言：Renderer 不再返回 pushResults
      expect(result).not.toHaveProperty("pushResults");
    });
  });
});
