import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';

export const RENDERABLE_NEWS_CONTRACT_VERSION = 'renderable-news/v1';
export const NEUROMANCER_RESEARCH_RECEIPT_VERSION = 'neuromancer-research/v1';

const RESEARCH_SOURCE_ROLES = new Set(['seed', 'primary', 'official', 'secondary', 'syndicated', 'community']);
const RESEARCH_CLAIM_STATUSES = new Set(['supported', 'context', 'unresolved', 'conflict']);
const RETRIEVAL_HEALTH_STATUSES = new Set(['healthy', 'degraded', 'unknown']);
const TOKEN_STATUSES = new Set(['reported', 'unavailable', 'invalid-zero']);

export interface NeuromancerResearchReceipt {
  schemaVersion: typeof NEUROMANCER_RESEARCH_RECEIPT_VERSION;
  agent: string;
  threadId?: string;
  runId?: string;
  generatedAt?: string;
  seed?: {
    title: string;
    content?: string;
    source?: string;
    link?: string;
    publishTime?: string;
  };
  sources: Array<{
    id: string;
    url: string;
    title?: string;
    role: 'seed' | 'primary' | 'official' | 'secondary' | 'syndicated' | 'community';
    note?: string;
  }>;
  claims: Array<{
    text: string;
    sourceIds: string[];
    status: 'supported' | 'context' | 'unresolved' | 'conflict';
  }>;
  retrieval?: {
    status: 'healthy' | 'degraded' | 'unknown';
    enginesUsed?: string[];
    unavailableEngines?: string[];
  };
  usage?: {
    providerReportedTokens?: {
      status: 'reported' | 'unavailable' | 'invalid-zero';
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
    normalizedContextTokens?: number;
    llmCalls?: number;
    toolCalls?: number;
    searchRequests?: number;
    crawlRequests?: number;
  };
}

type ResearchRetrieval = NonNullable<NeuromancerResearchReceipt['retrieval']>;
type ResearchUsage = NonNullable<NeuromancerResearchReceipt['usage']>;
type ProviderReportedTokens = NonNullable<ResearchUsage['providerReportedTokens']>;

export interface RenderableNewsValidationSuccess {
  ok: true;
  data: RenderableDataItem;
}

export interface RenderableNewsValidationFailure {
  ok: false;
  errors: string[];
}

export type RenderableNewsValidationResult =
  | RenderableNewsValidationSuccess
  | RenderableNewsValidationFailure;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textUnits(value: string): number {
  let units = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // CJK / full-width glyphs roughly occupy one full 12px pixel-font cell;
    // ASCII is materially narrower. Units are only a deterministic layout guard,
    // not a tokenizer or typography measurement.
    units += (
      (code >= 0x2e80 && code <= 0x9fff)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xff01 && code <= 0xff60)
    ) ? 2 : 1;
  }
  return units;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringArray(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    .slice(0, maxItems);
}

function cleanNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
}

function validateHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function canonicalEvidenceUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith('utm_') || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(normalized)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
    return parsed.toString();
  } catch {
    return undefined;
  }
}

const RESEARCH_SOURCE_ROLE_RANK: Record<string, number> = {
  official: 6,
  primary: 5,
  seed: 4,
  secondary: 3,
  community: 2,
  syndicated: 1,
};

/**
 * Normalizes only structurally equivalent Neuromancer finalizer output before the
 * strict validator runs. This must never invent or rewrite factual text.
 *
 * Safe normalizations:
 * - drop/merge duplicate evidence sources that resolve to the same canonical URL;
 * - remap claim sourceIds to the retained source id;
 * - keep only unique highlights that actually occur in message, capped at four.
 *
 * Substantive problems (unsupported claims, oversized title/message, invalid URLs,
 * missing evidence, conflicts) are deliberately left for the validator to reject.
 */
export function normalizeNeuromancerFinalArtifact(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const normalized: Record<string, unknown> = { ...input };
  const message = cleanString(normalized.message);

  if (Array.isArray(normalized.highlights)) {
    const highlights = cleanStringArray(normalized.highlights, 32)
      .filter((highlight) => message.includes(highlight))
      .slice(0, 4);
    if (highlights.length) normalized.highlights = highlights;
    else delete normalized.highlights;
  }

  if (!isPlainObject(normalized.metadata)) return normalized;
  const metadata: Record<string, unknown> = { ...normalized.metadata };
  normalized.metadata = metadata;
  if (!isPlainObject(metadata.researchReceipt)) return normalized;

  const receipt: Record<string, unknown> = { ...metadata.researchReceipt };
  metadata.researchReceipt = receipt;
  if (!Array.isArray(receipt.sources)) return normalized;

  const retainedSources: Record<string, unknown>[] = [];
  const canonicalToIndex = new Map<string, number>();
  const sourceAliases = new Map<string, string>();

  for (const raw of receipt.sources) {
    if (!isPlainObject(raw)) {
      retainedSources.push(raw as never);
      continue;
    }
    const source = { ...raw };
    const id = cleanString(source.id);
    const url = cleanString(source.url);
    const canonical = canonicalEvidenceUrl(url);
    if (!canonical) {
      retainedSources.push(source);
      if (id) sourceAliases.set(id, id);
      continue;
    }

    const existingIndex = canonicalToIndex.get(canonical);
    if (existingIndex === undefined) {
      canonicalToIndex.set(canonical, retainedSources.length);
      retainedSources.push(source);
      if (id) sourceAliases.set(id, id);
      continue;
    }

    const existing = retainedSources[existingIndex];
    const existingId = cleanString(existing.id);
    const retainedId = existingId || id;
    if (!existingId && id) existing.id = id;
    if (id && retainedId) sourceAliases.set(id, retainedId);
    if (existingId && retainedId) sourceAliases.set(existingId, retainedId);

    const existingRole = cleanString(existing.role);
    const candidateRole = cleanString(source.role);
    if ((RESEARCH_SOURCE_ROLE_RANK[candidateRole] || 0) > (RESEARCH_SOURCE_ROLE_RANK[existingRole] || 0)) {
      existing.role = source.role;
      if (cleanString(source.title)) existing.title = source.title;
      if (cleanString(source.note)) existing.note = source.note;
    }
  }
  receipt.sources = retainedSources;

  if (Array.isArray(receipt.claims)) {
    receipt.claims = receipt.claims.map((raw) => {
      if (!isPlainObject(raw) || !Array.isArray(raw.sourceIds)) return raw;
      const sourceIds = cleanStringArray(raw.sourceIds, 8)
        .map((sourceId) => sourceAliases.get(sourceId) || sourceId);
      return { ...raw, sourceIds: [...new Set(sourceIds)] };
    });
  }

  return normalized;
}

function validateResearchReceipt(value: unknown, errors: string[]): NeuromancerResearchReceipt | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    errors.push('metadata.researchReceipt 必须是 JSON object');
    return undefined;
  }

  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    errors.push('metadata.researchReceipt 必须可 JSON 序列化');
    return undefined;
  }
  if (serialized.length > 16_384) errors.push('metadata.researchReceipt 过大（最多 16KiB JSON）');

  const schemaVersion = cleanString(value.schemaVersion);
  const agent = cleanString(value.agent) || 'neuromancer';
  const threadId = cleanString(value.threadId);
  const runId = cleanString(value.runId);
  const generatedAt = cleanString(value.generatedAt);
  if (schemaVersion !== NEUROMANCER_RESEARCH_RECEIPT_VERSION) {
    errors.push(`metadata.researchReceipt.schemaVersion 必须是 ${NEUROMANCER_RESEARCH_RECEIPT_VERSION}`);
  }
  if (threadId.length > 128) errors.push('metadata.researchReceipt.threadId 过长');
  if (runId.length > 128) errors.push('metadata.researchReceipt.runId 过长');
  if (generatedAt && Number.isNaN(Date.parse(generatedAt))) errors.push('metadata.researchReceipt.generatedAt 必须是合法时间');

  let seed: NeuromancerResearchReceipt['seed'];
  if (value.seed !== undefined) {
    if (!isPlainObject(value.seed)) {
      errors.push('metadata.researchReceipt.seed 必须是 object');
    } else {
      const title = cleanString(value.seed.title);
      const content = cleanString(value.seed.content);
      const source = cleanString(value.seed.source);
      const link = cleanString(value.seed.link);
      const publishTime = cleanString(value.seed.publishTime);
      if (!title || title.length > 240) errors.push('metadata.researchReceipt.seed.title 无效');
      if (content.length > 1_000) errors.push('metadata.researchReceipt.seed.content 过长（最多 1000 字符）');
      if (source.length > 120) errors.push('metadata.researchReceipt.seed.source 过长');
      if (link && !validateHttpUrl(link)) errors.push('metadata.researchReceipt.seed.link 必须是 http/https URL');
      if (publishTime && Number.isNaN(Date.parse(publishTime))) errors.push('metadata.researchReceipt.seed.publishTime 必须是合法时间');
      seed = {
        title,
        ...(content ? { content } : {}),
        ...(source ? { source } : {}),
        ...(link ? { link } : {}),
        ...(publishTime ? { publishTime: new Date(publishTime).toISOString() } : {}),
      };
    }
  }

  const rawSources = Array.isArray(value.sources) ? value.sources : [];
  if (rawSources.length < 1) errors.push('metadata.researchReceipt.sources 至少 1 项');
  if (rawSources.length > 8) errors.push('metadata.researchReceipt.sources 最多 8 项');
  const sourceIds = new Set<string>();
  const sourceUrls = new Set<string>();
  const sources: NeuromancerResearchReceipt['sources'] = [];
  for (const [index, raw] of rawSources.slice(0, 8).entries()) {
    if (!isPlainObject(raw)) {
      errors.push(`metadata.researchReceipt.sources[${index}] 必须是 object`);
      continue;
    }
    const id = cleanString(raw.id);
    const url = cleanString(raw.url);
    const title = cleanString(raw.title);
    const role = cleanString(raw.role) as NeuromancerResearchReceipt['sources'][number]['role'];
    const note = cleanString(raw.note);
    if (!id || id.length > 40) errors.push(`metadata.researchReceipt.sources[${index}].id 无效`);
    if (id && sourceIds.has(id)) errors.push(`metadata.researchReceipt.sources source id 重复: ${id}`);
    if (!url || !validateHttpUrl(url)) {
      errors.push(`metadata.researchReceipt.sources[${index}].url 必须是 http/https URL`);
    } else {
      const canonicalUrl = canonicalEvidenceUrl(url);
      if (canonicalUrl && sourceUrls.has(canonicalUrl)) {
        errors.push(`metadata.researchReceipt.sources canonical URL 重复: ${canonicalUrl}`);
      }
      if (canonicalUrl) sourceUrls.add(canonicalUrl);
    }
    if (!RESEARCH_SOURCE_ROLES.has(role)) errors.push(`metadata.researchReceipt.sources[${index}].role 无效`);
    if (title.length > 180) errors.push(`metadata.researchReceipt.sources[${index}].title 过长`);
    if (note.length > 320) errors.push(`metadata.researchReceipt.sources[${index}].note 过长`);
    if (id) sourceIds.add(id);
    sources.push({ id, url, role, ...(title ? { title } : {}), ...(note ? { note } : {}) });
  }

  const rawClaims = Array.isArray(value.claims) ? value.claims : [];
  if (rawClaims.length < 1) errors.push('metadata.researchReceipt.claims 至少 1 项');
  if (rawClaims.length > 8) errors.push('metadata.researchReceipt.claims 最多 8 项');
  const claims: NeuromancerResearchReceipt['claims'] = [];
  for (const [index, raw] of rawClaims.slice(0, 8).entries()) {
    if (!isPlainObject(raw)) {
      errors.push(`metadata.researchReceipt.claims[${index}] 必须是 object`);
      continue;
    }
    const text = cleanString(raw.text);
    const status = cleanString(raw.status) as NeuromancerResearchReceipt['claims'][number]['status'];
    const claimSourceIds = cleanStringArray(raw.sourceIds, 8);
    if (!text || text.length > 320) errors.push(`metadata.researchReceipt.claims[${index}].text 无效`);
    if (!RESEARCH_CLAIM_STATUSES.has(status)) errors.push(`metadata.researchReceipt.claims[${index}].status 无效`);
    if (claimSourceIds.length < 1) errors.push(`metadata.researchReceipt.claims[${index}].sourceIds 至少 1 项`);
    for (const sourceId of claimSourceIds) {
      if (!sourceIds.has(sourceId)) errors.push(`metadata.researchReceipt.claims[${index}] 引用了未知 sourceId: ${sourceId}`);
    }
    claims.push({ text, sourceIds: claimSourceIds, status });
  }

  let retrieval: NeuromancerResearchReceipt['retrieval'];
  if (value.retrieval !== undefined) {
    if (!isPlainObject(value.retrieval)) {
      errors.push('metadata.researchReceipt.retrieval 必须是 object');
    } else {
      const rawRetrieval = value.retrieval;
      const status = cleanString(rawRetrieval.status) as ResearchRetrieval['status'];
      const enginesUsed = cleanStringArray(rawRetrieval.enginesUsed, 8);
      const unavailableEngines = cleanStringArray(rawRetrieval.unavailableEngines, 8);
      if (!RETRIEVAL_HEALTH_STATUSES.has(status)) errors.push('metadata.researchReceipt.retrieval.status 无效');
      retrieval = {
        status,
        ...(enginesUsed.length ? { enginesUsed } : {}),
        ...(unavailableEngines.length ? { unavailableEngines } : {}),
      };
    }
  }

  let usage: NeuromancerResearchReceipt['usage'];
  if (value.usage !== undefined) {
    if (!isPlainObject(value.usage)) {
      errors.push('metadata.researchReceipt.usage 必须是 object');
    } else {
      const rawUsage = value.usage;
      let providerReportedTokens: ProviderReportedTokens | undefined;
      if (rawUsage.providerReportedTokens !== undefined) {
        if (!isPlainObject(rawUsage.providerReportedTokens)) {
          errors.push('metadata.researchReceipt.usage.providerReportedTokens 必须是 object');
        } else {
          const rawTokens = rawUsage.providerReportedTokens;
          const status = cleanString(rawTokens.status) as ProviderReportedTokens['status'];
          if (!TOKEN_STATUSES.has(status)) errors.push('metadata.researchReceipt.usage.providerReportedTokens.status 无效');
          const tokenNumbers: Partial<Record<'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'total', number>> = {};
          for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) {
            const number = cleanNonNegativeNumber(rawTokens[key]);
            if (number !== undefined) tokenNumbers[key] = number;
          }
          providerReportedTokens = { status, ...tokenNumbers };
        }
      }
      const usageNumbers: Partial<Record<'normalizedContextTokens' | 'llmCalls' | 'toolCalls' | 'searchRequests' | 'crawlRequests', number>> = {};
      for (const key of ['normalizedContextTokens', 'llmCalls', 'toolCalls', 'searchRequests', 'crawlRequests'] as const) {
        const number = cleanNonNegativeNumber(rawUsage[key]);
        if (number !== undefined) usageNumbers[key] = number;
      }
      usage = {
        ...(providerReportedTokens ? { providerReportedTokens } : {}),
        ...usageNumbers,
      };
    }
  }

  return {
    schemaVersion: NEUROMANCER_RESEARCH_RECEIPT_VERSION,
    agent,
    ...(threadId ? { threadId } : {}),
    ...(runId ? { runId } : {}),
    ...(generatedAt ? { generatedAt: new Date(generatedAt).toISOString() } : {}),
    ...(seed ? { seed } : {}),
    sources,
    claims,
    ...(retrieval ? { retrieval } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function validateRenderableNews(input: unknown): RenderableNewsValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['data 必须是 JSON object'] };
  }

  const id = cleanString(input.id);
  const title = cleanString(input.title);
  const message = cleanString(input.message);
  const signature = cleanString(input.signature);
  const source = cleanString(input.source);
  const publishTime = cleanString(input.publishTime);
  const category = cleanString(input.category) || 'news';
  const link = cleanString(input.link);
  const errors: string[] = [];

  if (!id) errors.push('id 不能为空');
  if (!title) errors.push('title 不能为空');
  if (!message) errors.push('message 不能为空');
  if (!signature) errors.push('signature 不能为空');
  if (!source) errors.push('source 不能为空');
  if (!publishTime || Number.isNaN(Date.parse(publishTime))) errors.push('publishTime 必须是合法时间');
  if (id.length > 128) errors.push('id 过长（最多 128 字符）');

  // 296×152 few-shot 的保守容量门。超出时应该把 validator feedback
  // 返回给 Neuromancer 同一 thread 自修，而不是由 Quote0 截断正文。
  if (textUnits(title) > 32) errors.push('title 超出墨水屏容量（最多 32 display units，约 16 个全角字）');
  if (textUnits(message) > 160) errors.push('message 超出墨水屏容量（最多 160 display units，约 80 个全角字）');
  if (textUnits(source) > 36) errors.push('source 过长（最多 36 display units）');

  if (link && !validateHttpUrl(link)) errors.push('link 必须是合法 http/https URL');

  const highlights = Array.isArray(input.highlights)
    ? [...new Set(input.highlights.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : [];
  if (highlights.length > 4) errors.push('highlights 最多 4 个');
  for (const highlight of highlights) {
    if (!message.includes(highlight)) {
      errors.push(`highlight 不在 message 中: ${highlight}`);
    }
  }

  const metadata = isPlainObject(input.metadata) ? { ...input.metadata } : undefined;
  if (metadata) {
    let serialized = '';
    try {
      serialized = JSON.stringify(metadata);
    } catch {
      errors.push('metadata 必须可 JSON 序列化');
    }
    if (serialized.length > 20_480) errors.push('metadata 过大（最多 20KiB JSON）');
    if (Object.prototype.hasOwnProperty.call(metadata, 'researchReceipt')) {
      metadata.researchReceipt = validateResearchReceipt(metadata.researchReceipt, errors);
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      id,
      title,
      message,
      signature,
      source,
      publishTime: new Date(publishTime).toISOString(),
      category,
      ...(link ? { link } : {}),
      ...(highlights.length ? { highlights } : {}),
      ...(metadata ? { metadata } : {}),
    },
  };
}

export function normalizeRenderableDeviceIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean))];
}

export function minioImagePathFromRenderedImages(
  renderedImages: Array<{ imageUrl?: string; localImagePath?: string }> | undefined,
): string | undefined {
  const imageUrl = renderedImages?.find((item) => item.imageUrl)?.imageUrl;
  if (!imageUrl) return undefined;
  try {
    const pathname = new URL(imageUrl).pathname;
    const marker = '/quote0-images/';
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return undefined;
    return `/${pathname.slice(markerIndex + marker.length)}`;
  } catch {
    return undefined;
  }
}

export function buildRenderablePushContent(data: RenderableDataItem) {
  const metadata = isPlainObject(data.metadata) ? data.metadata : {};
  const researchReceipt = isPlainObject(metadata.researchReceipt) ? metadata.researchReceipt : undefined;
  const seed = researchReceipt && isPlainObject(researchReceipt.seed) ? researchReceipt.seed : undefined;
  const provenance = researchReceipt && Array.isArray(researchReceipt.sources)
    ? researchReceipt.sources
    : metadata;
  return {
    rawContent: {
      title: cleanString(seed?.title) || data.title,
      content: cleanString(seed?.content) || data.message,
      description: cleanString(seed?.content) || data.message,
      source: cleanString(seed?.source) || data.source,
      category: data.category,
      link: cleanString(seed?.link) || data.link,
      publishTime: cleanString(seed?.publishTime) || data.publishTime,
      origin: 'renderable-intake',
      contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
      provenance,
      ...(researchReceipt ? { researchReceipt } : {}),
    },
    processedContent: {
      title: data.title,
      message: data.message,
      summary: data.message,
      signature: data.signature,
      source: data.source,
      category: data.category,
      link: data.link,
      publishTime: data.publishTime,
      highlights: data.highlights,
      metadata: {
        contractVersion: RENDERABLE_NEWS_CONTRACT_VERSION,
        producer: 'external-renderable-agent',
        provenance,
        ...(researchReceipt ? { researchReceipt } : {}),
      },
    },
  };
}
