/**
 * 新闻处理服务单元测试
 * 验证 fingerprint 计算、上下文 enrich 等纯函数逻辑
 */

import { describe, it, expect } from "bun:test";
import { computeNewsFingerprint, enrichContextFromResult } from "./news-processing-service.js";
import type { NewsPushContext } from "./news-types.js";

describe("computeNewsFingerprint", () => {
  it("should produce identical hash for identical inputs", () => {
    const fp1 = computeNewsFingerprint({
      title: "OpenAI 发布新模型",
      link: "https://example.com/news/1",
      publishTime: "2026-05-27T10:00:00Z",
      source: "solidot",
      category: "technology",
      fallback: "rss:solidot:0"
    });
    const fp2 = computeNewsFingerprint({
      title: "OpenAI 发布新模型",
      link: "https://example.com/news/1",
      publishTime: "2026-05-27T10:00:00Z",
      source: "solidot",
      category: "technology",
      fallback: "rss:solidot:0"
    });
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(32);
  });

  it("should produce different hashes for different titles", () => {
    const fp1 = computeNewsFingerprint({
      title: "新闻A",
      link: "https://example.com/news/1",
      fallback: "rss:solidot:0"
    });
    const fp2 = computeNewsFingerprint({
      title: "新闻B",
      link: "https://example.com/news/1",
      fallback: "rss:solidot:0"
    });
    expect(fp1).not.toBe(fp2);
  });

  it("should fallback to fallback string when all fields are empty", () => {
    const fp1 = computeNewsFingerprint({ fallback: "rss:solidot:0" });
    const fp2 = computeNewsFingerprint({ fallback: "rss:solidot:0" });
    const fp3 = computeNewsFingerprint({ fallback: "rss:solidot:1" });

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });

  it("should normalize link to lowercase", () => {
    const fp1 = computeNewsFingerprint({
      title: "Test",
      link: "https://EXAMPLE.COM/News",
      fallback: "fb"
    });
    const fp2 = computeNewsFingerprint({
      title: "Test",
      link: "https://example.com/News",
      fallback: "fb"
    });
    expect(fp1).toBe(fp2);
  });

  it("should normalize publishTime to ISO string", () => {
    const fp1 = computeNewsFingerprint({
      title: "Test",
      publishTime: "2026-05-27T10:00:00.000Z",
      fallback: "fb"
    });
    const fp2 = computeNewsFingerprint({
      title: "Test",
      publishTime: "2026-05-27T10:00:00Z",
      fallback: "fb"
    });
    expect(fp1).toBe(fp2);
  });
});

describe("enrichContextFromResult", () => {
  it("should populate missing context fields from result", () => {
    const context: NewsPushContext = {};
    const result = {
      title: "Test Title",
      link: "https://example.com",
      source: "solidot",
      category: "technology",
      publishTime: "2026-05-27T10:00:00Z",
      fingerprint: "abc123"
    };

    enrichContextFromResult(context, result);

    expect(context.title).toBe("Test Title");
    expect(context.link).toBe("https://example.com");
    expect(context.source).toBe("solidot");
    expect(context.category).toBe("technology");
    expect(context.publishTime).toBe("2026-05-27T10:00:00Z");
    expect(context.fingerprint).toBe("abc123");
  });

  it("should not overwrite existing context fields", () => {
    const context: NewsPushContext = {
      title: "Existing Title",
      source: "existing-source"
    };
    const result = {
      title: "New Title",
      source: "new-source",
      link: "https://example.com"
    };

    enrichContextFromResult(context, result);

    expect(context.title).toBe("Existing Title");
    expect(context.source).toBe("existing-source");
    expect(context.link).toBe("https://example.com");
  });

  it("should handle null/undefined result gracefully", () => {
    const context: NewsPushContext = {};
    enrichContextFromResult(context, null);
    enrichContextFromResult(context, undefined);
    enrichContextFromResult(context, "string");
    expect(context).toEqual({});
  });
});
