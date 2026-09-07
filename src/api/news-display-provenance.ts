import { getRssSourceDefinition } from '../react-widgets/core/data-sources/rss-source-registry.js';

export const DISPLAY_PROVENANCE_VERSION = 'quote0-display-provenance/v1';

export interface DisplayProvenance {
  schemaVersion: typeof DISPLAY_PROVENANCE_VERSION;
  publisher: {
    label: string;
    url?: string;
    derivedFrom: 'rss-registry' | 'seed-link' | 'seed-source';
  };
  discovery?: {
    sourceId?: string;
    label: string;
  };
  research?: {
    agent: 'neuromancer';
    evidenceSourceCount: number;
    evidenceDomains: string[];
    policyVersion?: string;
    runId?: string;
  };
}

const AGGREGATOR_SOURCE_IDS = new Set(['hackernews']);

const HOST_LABELS: Array<[suffix: string, label: string]> = [
  ['infoq.cn', 'InfoQ 中文'],
  ['infoq.com', 'InfoQ'],
  ['dev.to', 'DEV Community'],
  ['solidot.org', 'Solidot'],
  ['arstechnica.com', 'Ars Technica'],
  ['github.blog', 'GitHub Changelog'],
  ['blog.cloudflare.com', 'Cloudflare Blog'],
  ['pcmag.com', 'PCMag'],
  ['fortune.com', 'Fortune'],
  ['prnewswire.com', 'PR Newswire'],
  ['modelcontextprotocol.io', 'MCP 官方'],
  ['openai.com', 'OpenAI'],
  ['reuters.com', 'Reuters'],
  ['apnews.com', 'AP'],
  ['ruv.is', 'RÚV'],
  ['youtube.com', 'YouTube'],
  ['x.com', 'X'],
  ['twitter.com', 'X'],
];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hostnameFromUrl(value: unknown): string {
  const raw = clean(value);
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function displayUnits(value: string): number {
  let units = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    units += (
      (code >= 0x2e80 && code <= 0x9fff)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xff01 && code <= 0xff60)
    ) ? 2 : 1;
  }
  return units;
}

function compactLabel(value: string, maxUnits = 36): string {
  const cleaned = clean(value).replace(/\s+/g, ' ');
  if (!cleaned) return '';
  if (displayUnits(cleaned) <= maxUnits) return cleaned;
  let out = '';
  for (const char of cleaned) {
    if (displayUnits(`${out}${char}…`) > maxUnits) break;
    out += char;
  }
  return `${out}…`;
}

export function publisherLabelFromUrl(url: unknown): string {
  const host = hostnameFromUrl(url);
  if (!host) return '';
  for (const [suffix, label] of HOST_LABELS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return label;
  }
  return compactLabel(host, 36);
}

export function evidenceDomainFromUrl(url: unknown): string {
  return hostnameFromUrl(url);
}

function labelsEquivalent(a: string, b: string): boolean {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·._\-/()（）]+/g, '');
  return Boolean(a && b && normalize(a) === normalize(b));
}

export function buildServerOwnedDisplayProvenance(input: {
  sourceId?: string;
  seedSource?: string;
  seedLink?: string;
  evidenceSources?: Array<{ url?: string; canonicalUrl?: string }>;
  research?: {
    policyVersion?: string;
    runId?: string;
  };
}): DisplayProvenance {
  const sourceId = clean(input.sourceId);
  const sourceDef = sourceId ? getRssSourceDefinition(sourceId) : undefined;
  const registryLabel = clean(sourceDef?.name);
  const seedSource = compactLabel(clean(input.seedSource), 36);
  const linkLabel = publisherLabelFromUrl(input.seedLink);
  const aggregator = AGGREGATOR_SOURCE_IDS.has(sourceId);

  let publisherLabel = '';
  let derivedFrom: DisplayProvenance['publisher']['derivedFrom'] = 'seed-source';
  if (aggregator && linkLabel) {
    publisherLabel = linkLabel;
    derivedFrom = 'seed-link';
  } else if (registryLabel) {
    publisherLabel = compactLabel(registryLabel, 36);
    derivedFrom = 'rss-registry';
  } else if (linkLabel) {
    publisherLabel = linkLabel;
    derivedFrom = 'seed-link';
  } else {
    publisherLabel = seedSource || '未知来源';
  }

  const discoveryLabel = registryLabel || seedSource;
  const discovery = discoveryLabel && !labelsEquivalent(discoveryLabel, publisherLabel)
    ? {
        ...(sourceId ? { sourceId } : {}),
        label: compactLabel(discoveryLabel, 30),
      }
    : undefined;

  const evidenceDomains = [...new Set((input.evidenceSources || [])
    .map((source) => evidenceDomainFromUrl(source.url || source.canonicalUrl))
    .filter(Boolean))];

  return {
    schemaVersion: DISPLAY_PROVENANCE_VERSION,
    publisher: {
      label: publisherLabel,
      ...(clean(input.seedLink) ? { url: clean(input.seedLink) } : {}),
      derivedFrom,
    },
    ...(discovery ? { discovery } : {}),
    ...(input.research ? {
      research: {
        agent: 'neuromancer',
        evidenceSourceCount: evidenceDomains.length,
        evidenceDomains,
        ...(clean(input.research.policyVersion) ? { policyVersion: clean(input.research.policyVersion) } : {}),
        ...(clean(input.research.runId) ? { runId: clean(input.research.runId) } : {}),
      },
    } : {}),
  };
}
