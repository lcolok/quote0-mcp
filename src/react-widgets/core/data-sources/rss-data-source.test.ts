/**
 * RSS 数据源模块单元测试
 * 验证 HTML 清理、指纹稳定性、以及 pingwest 失效后的配置
 */

import { describe, it, expect } from "bun:test";
import { RSSDataSourceModule, normalizeRssPublishTime } from "./rss-data-source.js";

describe("RSSDataSourceModule", () => {
  const module = new RSSDataSourceModule();

  describe("publish time normalization", () => {
    const now = Date.parse("2026-08-16T00:00:00.000Z");

    it("keeps normal source timestamps", () => {
      const result = normalizeRssPublishTime("2026-08-15T23:00:00.000Z", now);
      expect(result.publishTime).toBe("2026-08-15T23:00:00.000Z");
      expect(result.futureClamped).toBe(false);
    });

    it("clamps materially future source timestamps but preserves raw evidence", () => {
      const result = normalizeRssPublishTime("2026-08-16T00:40:00.000Z", now);
      expect(result.publishTime).toBe("2026-08-16T00:00:00.000Z");
      expect(result.rawPublishTime).toBe("2026-08-16T00:40:00.000Z");
      expect(result.futureClamped).toBe(true);
    });
  });

  describe("cleanContent", () => {
    // 通过 as any 访问 private 方法进行单元测试
    const clean = (content: string) => (module as any).cleanContent(content);

    it("should strip HTML tags completely", () => {
      expect(clean("<p>Hello <b>World</b></p>")).toBe("Hello World");
      expect(clean("<div><span>nested</span> content</div>")).toBe("nested content");
    });

    it("should collapse multiple whitespace characters into single space", () => {
      expect(clean("Hello    World")).toBe("Hello World");
      expect(clean("Hello\n\n\nWorld")).toBe("Hello World");
      expect(clean("Hello\t\tWorld")).toBe("Hello World");
      expect(clean("Hello \n\t World")).toBe("Hello World");
    });

    it("should trim leading and trailing whitespace", () => {
      expect(clean("  Hello World  ")).toBe("Hello World");
      expect(clean("\n\tHello World\n\t")).toBe("Hello World");
    });

    it("should handle HTML entities and mixed content", () => {
      expect(clean("<p>Hello&nbsp;World</p>")).toBe("Hello&nbsp;World");
      expect(clean("<a href='http://example.com'>link</a> text")).toBe("link text");
    });

    it("should return empty string for empty input", () => {
      expect(clean("")).toBe("");
      expect(clean("   ")).toBe("");
    });
  });

  describe("getAvailableFeeds", () => {
    it("should not include pingwest in available feeds", () => {
      const feeds = module.getAvailableFeeds();
      expect(feeds).not.toHaveProperty("pingwest");
    });

    it("should still include solidot, sspai, cnbeta and other valid sources", () => {
      const feeds = module.getAvailableFeeds();
      expect(feeds).toHaveProperty("solidot");
      expect(feeds).toHaveProperty("sspai");
      expect(feeds).toHaveProperty("cnbeta");
      expect(feeds).toHaveProperty("hackernews");
    });
  });
});
