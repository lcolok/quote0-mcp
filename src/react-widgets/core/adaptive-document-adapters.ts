import type { RenderableDataItem } from './modular-architecture.js';
import { createAdaptiveTextCardDocument, type AdaptiveDocument } from './adaptive-layout.js';

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function renderableNewsToAdaptiveDocument(data: RenderableDataItem): AdaptiveDocument {
  const metadata = asRecord(data.metadata);
  const receipt = asRecord(metadata?.researchReceipt);
  const sources = Array.isArray(receipt?.sources) ? receipt.sources : [];
  const claims = Array.isArray(receipt?.claims) ? receipt.claims : [];
  const retrieval = asRecord(receipt?.retrieval);
  const isResearch = Boolean(receipt) || data.signature === '神经漫游者' || metadata?.producer === 'external-renderable-agent';
  const highlights = Array.isArray(data.highlights)
    ? data.highlights.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const keyword = isResearch ? highlights.slice(0, 2).join(' · ') : '';
  const meta = isResearch
    ? [
        sources.length > 0 ? `${sources.length} sources` : null,
        claims.length > 0 ? `${claims.length} claims` : null,
        retrieval?.status ? String(retrieval.status) : null,
      ].filter(Boolean).join(' · ')
    : '';
  return createAdaptiveTextCardDocument({
    id: `renderable-${data.id}`,
    visualPreset: isResearch ? 'news-research' : 'news-current-inspired',
    eyebrow: isResearch ? 'NEUROMANCER · RESEARCH' : undefined,
    title: data.title,
    body: data.message,
    keyword: keyword || undefined,
    meta: meta || undefined,
    footer: data.source ? `来源: ${data.source}` : undefined,
  });
}
