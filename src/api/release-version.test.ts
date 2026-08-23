import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEWS_API_RELEASE_VERSION, loadReleaseVersion, parseReleaseVersion } from './release-version.js';

describe('news-api release identity', () => {
  test('current checkout reports the manifest release instead of the legacy 1.0.0', () => {
    expect(NEWS_API_RELEASE_VERSION).toBe('1.21.94');
    expect(NEWS_API_RELEASE_VERSION).not.toBe('1.0.0');
  });

  test('parses only the top-level release envelope version', () => {
    const manifest = `version: 1.21.71\nservices:\n  news-api:\n    image: example/quote0-mcp-api:v1.21.71\n`;
    expect(parseReleaseVersion(manifest)).toBe('1.21.71');
  });

  test('fails parsing instead of silently falling back to the legacy 1.0.0', () => {
    expect(() => parseReleaseVersion('version: latest\n')).toThrow('valid top-level SemVer');
  });

  test('returns unknown when the build-time manifest is unavailable', () => {
    expect(loadReleaseVersion('/definitely/not/a/quote0/manifest.yml')).toBe('unknown');
  });

  test('loads the version from the manifest copied into the image', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quote0-release-version-'));
    const manifestPath = join(dir, 'lzc-manifest.yml');
    writeFileSync(manifestPath, 'version: 1.22.3\n');
    expect(loadReleaseVersion(manifestPath)).toBe('1.22.3');
  });
});
