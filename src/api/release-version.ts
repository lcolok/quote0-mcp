import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_MANIFEST_PATH = resolve(process.cwd(), 'lazycat', 'lzc-manifest.yml');

export function parseReleaseVersion(manifestText: string): string {
  const match = manifestText.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m);
  if (!match) {
    throw new Error('Quote0 release manifest is missing a valid top-level SemVer version');
  }
  return match[1];
}

export function loadReleaseVersion(manifestPath = DEFAULT_MANIFEST_PATH): string {
  try {
    return parseReleaseVersion(readFileSync(manifestPath, 'utf8'));
  } catch {
    return 'unknown';
  }
}

/**
 * Build-time component identity.
 *
 * Dockerfile.api copies the release manifest into the news-api image. That means
 * a pinned old news-api image keeps reporting the version it was actually built
 * from even when a later app envelope only rebuilds annotation-web/label-web.
 */
export const NEWS_API_RELEASE_VERSION = loadReleaseVersion();
