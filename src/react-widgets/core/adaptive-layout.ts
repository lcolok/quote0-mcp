import type { RenderTarget } from './render-targets.js';

export const ADAPTIVE_LAYOUT_VERSION = 'adaptive-layout/v1';

export type AdaptiveTextRole = 'eyebrow' | 'title' | 'body' | 'keyword' | 'meta' | 'footer';
export type AdaptivePriority = 'critical' | 'high' | 'medium' | 'low';
export type AdaptiveOverflowStrategy = 'fit' | 'clamp' | 'omit';
export type AdaptiveDensity = 'micro' | 'compact' | 'standard' | 'comfortable';

export interface AdaptiveNodeConstraints {
  minLines?: number;
  preferredLines?: number;
  optional?: boolean;
  priority?: AdaptivePriority;
  overflow?: AdaptiveOverflowStrategy[];
  baseFontPx?: number;
  minFontPx?: number;
}

export interface AdaptiveTextNode {
  id: string;
  kind: 'text';
  role: AdaptiveTextRole;
  text: string;
  constraints?: AdaptiveNodeConstraints;
}

export type AdaptiveNode = AdaptiveTextNode;

export interface AdaptiveDocument {
  id: string;
  nodes: AdaptiveNode[];
  paddingXPx?: number;
  paddingYPx?: number;
  gapPx?: number;
}

export interface AdaptivePlannedNode {
  id: string;
  role: AdaptiveTextRole;
  text: string;
  priority: AdaptivePriority;
  optional: boolean;
  overflow: AdaptiveOverflowStrategy[];
  visible: boolean;
  clampLines: number;
  preferredLines: number;
  minLines: number;
  estimatedWrappedLines: number;
  fontPx: number;
  lineHeightPx: number;
  estimatedHeightPx: number;
}

export interface AdaptiveLayoutPlan {
  version: typeof ADAPTIVE_LAYOUT_VERSION;
  documentId: string;
  targetId: string;
  density: AdaptiveDensity;
  widthPx: number;
  heightPx: number;
  paddingXPx: number;
  paddingYPx: number;
  gapPx: number;
  fontScale: number;
  availableHeightPx: number;
  estimatedHeightPx: number;
  overflowRisk: boolean;
  visibleNodeIds: string[];
  hiddenNodeIds: string[];
  decisions: string[];
  nodes: AdaptivePlannedNode[];
}

export interface AdaptiveTextCardContent {
  id?: string;
  eyebrow?: string;
  title: string;
  body?: string;
  keyword?: string;
  meta?: string;
  footer?: string;
}

interface RoleDefaults {
  priority: AdaptivePriority;
  optional: boolean;
  minLines: number;
  preferredLines: number;
  baseFontPx: number;
  minFontPx: number;
  lineHeightRatio: number;
}

const ROLE_DEFAULTS: Record<AdaptiveTextRole, RoleDefaults> = {
  eyebrow: { priority: 'medium', optional: true, minLines: 0, preferredLines: 1, baseFontPx: 9, minFontPx: 6, lineHeightRatio: 1.15 },
  title: { priority: 'critical', optional: false, minLines: 1, preferredLines: 2, baseFontPx: 18, minFontPx: 10, lineHeightRatio: 1.12 },
  body: { priority: 'high', optional: false, minLines: 1, preferredLines: 4, baseFontPx: 11, minFontPx: 7, lineHeightRatio: 1.2 },
  keyword: { priority: 'high', optional: true, minLines: 0, preferredLines: 1, baseFontPx: 9, minFontPx: 6, lineHeightRatio: 1.15 },
  meta: { priority: 'medium', optional: true, minLines: 0, preferredLines: 1, baseFontPx: 8, minFontPx: 6, lineHeightRatio: 1.15 },
  footer: { priority: 'low', optional: true, minLines: 0, preferredLines: 1, baseFontPx: 8, minFontPx: 6, lineHeightRatio: 1.15 },
};

const PRIORITY_WEIGHT: Record<AdaptivePriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const DENSITY_MAX_LINES: Record<AdaptiveDensity, Record<AdaptiveTextRole, number>> = {
  micro: { eyebrow: 0, title: 1, body: 2, keyword: 1, meta: 0, footer: 0 },
  compact: { eyebrow: 0, title: 2, body: 3, keyword: 1, meta: 1, footer: 1 },
  standard: { eyebrow: 1, title: 2, body: 4, keyword: 1, meta: 1, footer: 1 },
  comfortable: { eyebrow: 1, title: 3, body: 6, keyword: 2, meta: 1, footer: 1 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function deriveAdaptiveDensity(target: Pick<RenderTarget, 'widthPx' | 'heightPx'>): AdaptiveDensity {
  if (target.heightPx <= 80 || target.widthPx <= 180) return 'micro';
  if (target.heightPx <= 132) return 'compact';
  if (target.heightPx <= 190) return 'standard';
  return 'comfortable';
}

function visualTextUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (/\s/u.test(char)) units += 0.35;
    else if (/^[\x00-\x7F]$/u.test(char)) units += 0.55;
    else units += 1;
  }
  return units;
}

export function estimateWrappedLines(text: string, widthPx: number, fontPx: number): number {
  if (!text) return 0;
  const usableWidth = Math.max(1, widthPx);
  const unitsPerLine = Math.max(1, usableWidth / Math.max(1, fontPx * 0.92));
  return Math.max(1, Math.ceil(visualTextUnits(text) / unitsPerLine));
}

export function createAdaptiveTextCardDocument(content: AdaptiveTextCardContent): AdaptiveDocument {
  const title = cleanText(content.title);
  if (!title) throw new Error('AdaptiveDocument title must not be empty');

  const nodes: AdaptiveNode[] = [];
  const push = (role: AdaptiveTextRole, text: string | undefined) => {
    const cleaned = cleanText(text);
    if (cleaned) nodes.push({ id: role, kind: 'text', role, text: cleaned });
  };

  push('eyebrow', content.eyebrow);
  push('title', title);
  push('body', content.body);
  push('keyword', content.keyword);
  push('meta', content.meta);
  push('footer', content.footer);

  return {
    id: cleanText(content.id) || 'adaptive-text-card',
    nodes,
    paddingXPx: 6,
    paddingYPx: 4,
    gapPx: 4,
  };
}

function normalizedConstraint(node: AdaptiveNode) {
  const defaults = ROLE_DEFAULTS[node.role];
  const minLines = Math.max(0, Math.round(node.constraints?.minLines ?? defaults.minLines));
  const preferredLines = Math.max(minLines, Math.round(node.constraints?.preferredLines ?? defaults.preferredLines));
  return {
    priority: node.constraints?.priority ?? defaults.priority,
    optional: node.constraints?.optional ?? defaults.optional,
    minLines,
    preferredLines,
    overflow: node.constraints?.overflow ?? (defaults.optional ? ['fit', 'clamp', 'omit'] : ['fit', 'clamp']),
    baseFontPx: Math.max(1, node.constraints?.baseFontPx ?? defaults.baseFontPx),
    minFontPx: Math.max(1, node.constraints?.minFontPx ?? defaults.minFontPx),
    lineHeightRatio: defaults.lineHeightRatio,
  } as const;
}

function computeEstimatedHeight(nodes: AdaptivePlannedNode[], gapPx: number, paddingYPx: number): number {
  const visible = nodes.filter((node) => node.visible && node.clampLines > 0);
  const contentHeight = visible.reduce((sum, node) => sum + node.estimatedHeightPx, 0);
  return contentHeight + Math.max(0, visible.length - 1) * gapPx + paddingYPx * 2;
}

function refreshNodeHeight(node: AdaptivePlannedNode): void {
  node.lineHeightPx = Math.max(node.fontPx + 1, Math.round(node.fontPx * ROLE_DEFAULTS[node.role].lineHeightRatio));
  node.estimatedHeightPx = node.visible ? node.clampLines * node.lineHeightPx : 0;
}

export function planAdaptiveLayout(document: AdaptiveDocument, target: RenderTarget): AdaptiveLayoutPlan {
  if (!document.nodes.length) throw new Error('AdaptiveDocument must contain at least one node');
  if (target.widthPx <= 0 || target.heightPx <= 0) throw new Error(`Invalid adaptive target ${target.widthPx}x${target.heightPx}`);

  const density = deriveAdaptiveDensity(target);
  const geometryScale = clamp(Math.min(target.widthPx / 296, target.heightPx / 152), 0.55, 1.25);
  const paddingXPx = Math.max(2, Math.round((document.paddingXPx ?? 6) * geometryScale));
  const paddingYPx = Math.max(1, Math.round((document.paddingYPx ?? 4) * geometryScale));
  let gapPx = Math.max(1, Math.round((document.gapPx ?? 4) * geometryScale));
  const contentWidthPx = Math.max(1, target.widthPx - paddingXPx * 2);
  const decisions: string[] = [];

  const nodes: AdaptivePlannedNode[] = document.nodes.map((node) => {
    const constraints = normalizedConstraint(node);
    const densityCap = DENSITY_MAX_LINES[density][node.role];
    const fontPx = Math.max(constraints.minFontPx, Math.round(constraints.baseFontPx * geometryScale));
    const estimatedWrapped = estimateWrappedLines(node.text, contentWidthPx, fontPx);
    const allowedPreferred = Math.min(constraints.preferredLines, densityCap);
    let visible = densityCap > 0 || !constraints.optional;
    let clampLines = visible
      ? Math.max(constraints.minLines, Math.min(allowedPreferred || constraints.minLines, estimatedWrapped))
      : 0;

    if (constraints.optional && densityCap === 0) {
      visible = false;
      clampLines = 0;
      decisions.push(`${node.id}: omitted by ${density} density policy`);
    }

    const planned: AdaptivePlannedNode = {
      id: node.id,
      role: node.role,
      text: node.text,
      priority: constraints.priority,
      optional: constraints.optional,
      overflow: [...constraints.overflow],
      visible,
      clampLines,
      preferredLines: constraints.preferredLines,
      minLines: constraints.minLines,
      estimatedWrappedLines: estimatedWrapped,
      fontPx,
      lineHeightPx: 0,
      estimatedHeightPx: 0,
    };
    refreshNodeHeight(planned);
    return planned;
  });

  const availableHeightPx = target.heightPx;
  let estimatedHeightPx = computeEstimatedHeight(nodes, gapPx, paddingYPx);

  if (estimatedHeightPx > availableHeightPx && gapPx > 1) {
    const before = gapPx;
    gapPx = Math.max(1, Math.floor(gapPx / 2));
    decisions.push(`gap: ${before}px -> ${gapPx}px`);
    estimatedHeightPx = computeEstimatedHeight(nodes, gapPx, paddingYPx);
  }

  const reducible = [...nodes].sort((a, b) => {
    const priority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (priority !== 0) return priority;
    return Number(b.optional) - Number(a.optional);
  });
  for (const node of reducible) {
    while (estimatedHeightPx > availableHeightPx && node.visible && node.clampLines > node.minLines) {
      node.clampLines -= 1;
      refreshNodeHeight(node);
      decisions.push(`${node.id}: clamp -> ${node.clampLines} lines`);
      estimatedHeightPx = computeEstimatedHeight(nodes, gapPx, paddingYPx);
    }
  }

  for (const node of reducible) {
    if (estimatedHeightPx <= availableHeightPx) break;
    if (!node.visible || !node.optional || !node.overflow.includes('omit')) continue;
    node.visible = false;
    node.clampLines = 0;
    refreshNodeHeight(node);
    decisions.push(`${node.id}: omitted to fit height`);
    estimatedHeightPx = computeEstimatedHeight(nodes, gapPx, paddingYPx);
  }

  let fontScale = 1;
  while (estimatedHeightPx > availableHeightPx && fontScale > 0.82) {
    fontScale = round2(fontScale - 0.05);
    for (const node of nodes) {
      if (!node.visible) continue;
      const constraints = normalizedConstraint(document.nodes.find((candidate) => candidate.id === node.id)!);
      node.fontPx = Math.max(constraints.minFontPx, Math.round(constraints.baseFontPx * geometryScale * fontScale));
      refreshNodeHeight(node);
    }
    decisions.push(`fontScale -> ${fontScale}`);
    estimatedHeightPx = computeEstimatedHeight(nodes, gapPx, paddingYPx);
  }

  const overflowRisk = estimatedHeightPx > availableHeightPx;
  if (overflowRisk) decisions.push(`overflow-risk: estimated ${estimatedHeightPx}px > ${availableHeightPx}px`);

  return {
    version: ADAPTIVE_LAYOUT_VERSION,
    documentId: document.id,
    targetId: target.id,
    density,
    widthPx: target.widthPx,
    heightPx: target.heightPx,
    paddingXPx,
    paddingYPx,
    gapPx,
    fontScale,
    availableHeightPx,
    estimatedHeightPx,
    overflowRisk,
    visibleNodeIds: nodes.filter((node) => node.visible).map((node) => node.id),
    hiddenNodeIds: nodes.filter((node) => !node.visible).map((node) => node.id),
    decisions,
    nodes,
  };
}
