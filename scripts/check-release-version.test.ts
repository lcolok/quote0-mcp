import { describe, expect, test } from "bun:test";
import {
  compareSemver,
  parseReleaseManifest,
  validateReleaseState,
  type ReleaseState,
} from "./check-release-version";

const manifest = `
version: 1.21.71
services:
  annotation-web:
#@build if env.DEV_MODE=1
    image: dev.logic.heiyu.space/friday/quote0-annotation-web:latest
#@build else
    image: dev.logic.heiyu.space/friday/quote0-annotation-web:v1.21.68
#@build end
  label-web:
#@build if env.DEV_MODE=1
    image: dev.logic.heiyu.space/friday/quote0-label-web:v1.21.25-dev
#@build else
    image: dev.logic.heiyu.space/friday/quote0-label-web:v1.21.29
#@build end
  news-api:
#@build if env.DEV_MODE=1
    image: dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.14-dev
#@build else
    image: dev.logic.heiyu.space/friday/quote0-mcp-api:v1.21.71
#@build end
`;

describe("release version governance", () => {
  test("parses only production image tags and preserves intentional component skew", () => {
    expect(parseReleaseManifest(manifest)).toEqual({
      appVersion: "1.21.71",
      components: {
        "annotation-web": "1.21.68",
        "label-web": "1.21.29",
        "news-api": "1.21.71",
      },
    });
  });

  test("compares semantic versions numerically", () => {
    expect(compareSemver("1.21.71", "1.21.68")).toBeGreaterThan(0);
    expect(compareSemver("1.21.9", "1.21.10")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
  });

  test("accepts a release envelope with one current component and older pinned components", () => {
    expect(validateReleaseState(parseReleaseManifest(manifest))).toEqual([]);
  });

  test("rejects a component ahead of the release envelope", () => {
    const state: ReleaseState = {
      appVersion: "1.21.71",
      components: {
        "news-api": "1.21.72",
        "annotation-web": "1.21.68",
        "label-web": "1.21.29",
      },
    };
    expect(validateReleaseState(state).join("\n")).toContain("超前于应用 release envelope");
  });

  test("rejects ghost releases where no production image owns the envelope version", () => {
    const state: ReleaseState = {
      appVersion: "1.21.71",
      components: {
        "news-api": "1.21.70",
        "annotation-web": "1.21.68",
        "label-web": "1.21.29",
      },
    };
    expect(validateReleaseState(state).join("\n")).toContain("ghost release");
  });
});
