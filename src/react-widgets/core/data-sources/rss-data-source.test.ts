/**
 * RSS 数据源模块单元测试
 * 验证 HTML 清理、指纹稳定性、以及 pingwest 失效后的配置
 */

import { describe, it, expect } from "bun:test";
import {
  RSSDataSourceModule,
  buildRssIdentityKey,
  normalizeRssIdentityValue,
  normalizeRssPublishTime,
} from "./rss-data-source.js";

describe("RSSDataSourceModule", () => {
  const module = new RSSDataSourceModule();

  describe("publish time normalization", () => {
    const now = Date.parse("2026-08-16T00:00:00.000Z");

    it("keeps normal source timestamps as both display and stable identity time", () => {
      const result = normalizeRssPublishTime("2026-08-15T23:00:00.000Z", now);
      expect(result.publishTime).toBe("2026-08-15T23:00:00.000Z");
      expect(result.identityPublishTime).toBe("2026-08-15T23:00:00.000Z");
      expect(result.futureClamped).toBe(false);
    });

    it("clamps materially future display time but preserves a stable source identity time", () => {
      const result = normalizeRssPublishTime("2026-08-16T00:40:00.000Z", now);
      expect(result.publishTime).toBe("2026-08-16T00:00:00.000Z");
      expect(result.identityPublishTime).toBe("2026-08-16T00:40:00.000Z");
      expect(result.rawPublishTime).toBe("2026-08-16T00:40:00.000Z");
      expect(result.futureClamped).toBe(true);
    });

    it("never synthesizes identity time from the fetch clock when pubDate is missing", () => {
      const first = normalizeRssPublishTime(undefined, now);
      const second = normalizeRssPublishTime(undefined, now + 60 * 60 * 1000);
      expect(first.publishTime).not.toBe(second.publishTime);
      expect(first.identityPublishTime).toBeUndefined();
      expect(second.identityPublishTime).toBeUndefined();
    });

    it("keeps an invalid but stable feed timestamp as identity evidence", () => {
      const first = normalizeRssPublishTime("not-a-date", now);
      const second = normalizeRssPublishTime("not-a-date", now + 60 * 60 * 1000);
      expect(first.publishTime).not.toBe(second.publishTime);
      expect(first.identityPublishTime).toBe("not-a-date");
      expect(second.identityPublishTime).toBe("not-a-date");
    });
  });

  describe("stable RSS subject identity", () => {
    it("uses source + canonical guid/link instead of mutable publication time", () => {
      const link = "https://www.infoq.cn/article/abc123?utm_source=rss&utm_medium=article";
      const first = buildRssIdentityKey({ sourceId: "infoq-cn", guid: link, link, title: "Same story" });
      const later = buildRssIdentityKey({
        sourceId: "infoq-cn",
        guid: link,
        link,
        title: "Same story (title corrected)",
        identityPublishTime: "2026-08-23T11:25:00.000Z",
      });
      expect(first).toBe(later);
      expect(first).toBe("infoq-cn::https://www.infoq.cn/article/abc123");
    });

    it("prefers persisted link over an incompatible feed guid during rollout", () => {
      const key = buildRssIdentityKey({
        sourceId: "feed-a",
        guid: "opaque-guid-123",
        link: "https://example.com/story?utm_source=rss",
      });
      expect(key).toBe("feed-a::https://example.com/story");
    });

    it("removes tracking-only query parameters but preserves semantic query parameters", () => {
      expect(normalizeRssIdentityValue("https://example.com/story?id=42&utm_source=rss#section"))
        .toBe("https://example.com/story?id=42");
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
