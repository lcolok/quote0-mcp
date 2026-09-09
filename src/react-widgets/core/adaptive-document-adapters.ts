import type { RenderableDataItem } from './modular-architecture.js';
import {
  createAdaptiveTextCardDocument,
  type AdaptiveDocument,
} from './adaptive-layout.js';

interface ResearchReceiptLike {
  sources?: unknown[];
  claims?: unknown[];
  agent?: unknown;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function researchReceipt(item: RenderableDataItem): ResearchReceiptLike | undefined {
  const value = item.metadata?.researchReceipt;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ResearchReceiptLike
    : undefined;
}

function researchMeta(item: RenderableDataItem): string | undefined {
  const receipt = researchReceipt(item);
  if (!receipt) return undefined;
  const sources = Array.isArray(receipt.sources) ? receipt.sources.length : 0;
  const claims = Array.isArray(receipt.claims) ? receipt.claims.length : 0;
  if (!sources && !claims) return undefined;
  return `${sources} sources · ${claims} claims`;
}

/**
 * Convert Quote0's existing semantic news contract into the renderer-neutral
 * AdaptiveDocument. Physical target geometry intentionally does not enter here.
 *
 * publishTime is also intentionally excluded: time identity belongs to the
 * Quote0 domain layer and must not influence layout semantics or be rewritten by
 * a renderer/finalizer.
 */
export function renderableNewsToAdaptiveDocument(item: RenderableDataItem): AdaptiveDocument {
  const highlights = Array.isArray(item.highlights)
    ? item.highlights.map(cleanString).filter(Boolean).slice(0, 2)
    : [];
  const signature = cleanString(item.signature);
  const source = cleanString(item.source);

  return createAdaptiveTextCardDocument({
    id: cleanString(item.id) || 'renderable-news',
    eyebrow: signature || undefined,
    title: item.title,
    body: item.message,
    keyword: highlights.length ? highlights.join(' · ') : undefined,
    meta: researchMeta(item),
    footer: source || undefined,
  });
}
