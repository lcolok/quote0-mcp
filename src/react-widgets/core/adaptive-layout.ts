import { deriveNewsLayout, type RenderTarget } from './render-targets.js';

export const ADAPTIVE_LAYOUT_VERSION = 'adaptive-layout/v2';

export type AdaptiveTextRole = 'eyebrow' | 'title' | 'body' | 'keyword' | 'meta' | 'footer';
export type AdaptivePriority = 'critical' | 'high' | 'medium' | 'low';
export type AdaptiveOverflowStrategy = 'fit' | 'clamp' | 'omit';
export type AdaptiveDensity = 'micro' | 'compact' | 'standard' | 'comfortable';
export type AdaptiveVisualPreset = 'generic-stack' | 'news-current-inspired' | 'news-research';

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
  visualPreset?: AdaptiveVisualPreset;
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

export interface AdaptiveVisualGrammar {
  preset: AdaptiveVisualPreset;
  titleTreatment: 'plain' | 'inverse-banner';
  bodyTreatment: 'flow' | 'fill';
  footerTreatment: 'flow' | 'bottom-rule';
  verticalAlign: 'top' | 'center';
}

export interface AdaptiveLayoutRegion {
  heightPx: number;
  paddingXPx: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  gapPx: number;
}

export interface AdaptiveLayoutRegions {
  titleBanner: AdaptiveLayoutRegion;
  body: AdaptiveLayoutRegion;
  footer: AdaptiveLayoutRegion;
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
  contentUtilization: number;
  bodyVisibleLines: number;
  overflowRisk: boolean;
  visualGrammar: AdaptiveVisualGrammar;
  regions: AdaptiveLayoutRegions | null;
  visibleNodeIds: string[];
  hiddenNodeIds: string[];
  decisions: string[];
  nodes: AdaptivePlannedNode[];
}

const ROLE_DEFAULTS: Record<AdaptiveTextRole, Required<Pick<AdaptiveNodeConstraints, 'minLines' | 'preferredLines' | 'optional' | 'priority' | 'overflow' | 'baseFontPx' | 'minFontPx'>>> = {
  eyebrow: { minLines: 0, preferredLines: 1, optional: true, priority: 'medium', overflow: ['fit', 'clamp', 'omit'], baseFontPx: 9, minFontPx: 6 },
  title: { minLines: 1, preferredLines: 2, optional: false, priority: 'critical', overflow: ['fit', 'clamp'], baseFontPx: 18, minFontPx: 10 },
  body: { minLines: 1, preferredLines: 4, optional: false, priority: 'high', overflow: ['fit', 'clamp'], baseFontPx: 11, minFontPx: 7 },
  keyword: { minLines: 0, preferredLines: 1, optional: true, priority: 'high', overflow: ['fit', 'clamp', 'omit'], baseFontPx: 9, minFontPx: 6 },
  meta: { minLines: 0, preferredLines: 1, optional: true, priority: 'medium', overflow: ['fit', 'clamp', 'omit'], baseFontPx: 8, minFontPx: 6 },
  footer: { minLines: 0, preferredLines: 1, optional: true, priority: 'low', overflow: ['fit', 'clamp', 'omit'], baseFontPx: 8, minFontPx: 6 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function utilization(usedPx: number, availablePx: number): number {
  if (availablePx <= 0) return 1;
  return round(clamp(usedPx / availablePx, 0, 1));
}

export function deriveAdaptiveDensity(target: Pick<RenderTarget, 'widthPx' | 'heightPx'>): AdaptiveDensity {
  if (target.heightPx <= 80 || target.widthPx <= 180) return 'micro';
  if (target.heightPx <= 132) return 'compact';
  if (target.heightPx <= 190) return 'standard';
  return 'comfortable';
}

function densityLineCap(role: AdaptiveTextRole, density: AdaptiveDensity, preferred: number): number {
  if (density === 'micro') {
    if (role === 'title') return 1;
    if (role === 'body') return 2;
    return Math.min(1, preferred);
  }
  if (density === 'compact') {
    if (role === 'title') return 2;
    if (role === 'body') return 2;
    return Math.min(1, preferred);
  }
  if (density === 'standard') {
    if (role === 'body') return Math.min(3, preferred);
    return Math.min(2, preferred);
  }
  return preferred;
}

function densityOmitRole(role: AdaptiveTextRole, density: AdaptiveDensity): boolean {
  if (density === 'micro') return role === 'eyebrow' || role === 'keyword' || role === 'meta' || role === 'footer';
  if (density === 'compact') return role === 'eyebrow';
  return false;
}

function textUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (/\s/.test(char)) units += 0.35;
    else if (code <= 0x7f) units += /[A-Z0-9]/.test(char) ? 0.62 : 0.54;
    else units += 1;
  }
  return units;
}

export function estimateAdaptiveWrappedLines(text: string, widthPx: number, fontPx: number): number {
  if (!text.trim()) return 0;
  const unitsPerLine = Math.max(1, widthPx / Math.max(1, fontPx));
  return Math.max(1, Math.ceil(textUnits(text) / unitsPerLine));
}

function estimatePlanHeight(nodes: AdaptivePlannedNode[], paddingYPx: number, gapPx: number): number {
  const visible = nodes.filter((node) => node.visible && node.clampLines > 0);
  return paddingYPx * 2
    + visible.reduce((sum, node) => sum + node.estimatedHeightPx, 0)
    + Math.max(0, visible.length - 1) * gapPx;
}

function refreshNodeGeometry(
  node: AdaptivePlannedNode,
  contentWidthPx: number,
  lineHeightOverride?: number,
): AdaptivePlannedNode {
  const estimatedWrappedLines = estimateAdaptiveWrappedLines(node.text, contentWidthPx, node.fontPx);
  const lineHeightPx = lineHeightOverride ?? Math.max(node.fontPx + 1, Math.round(node.fontPx * 1.16));
  const effectiveLines = node.visible ? Math.min(node.clampLines, estimatedWrappedLines) : 0;
  return {
    ...node,
    estimatedWrappedLines,
    lineHeightPx,
    estimatedHeightPx: effectiveLines * lineHeightPx,
  };
}

function visualGrammarFor(document: AdaptiveDocument): AdaptiveVisualGrammar {
  const preset = document.visualPreset ?? 'generic-stack';
  if (preset === 'news-current-inspired' || preset === 'news-research') {
    return {
      preset,
      titleTreatment: 'inverse-banner',
      bodyTreatment: 'fill',
      footerTreatment: 'bottom-rule',
      verticalAlign: 'top',
    };
  }
  return {
    preset,
    titleTreatment: 'plain',
    bodyTreatment: 'flow',
    footerTreatment: 'flow',
    verticalAlign: 'center',
  };
}

function planGenericLayout(document: AdaptiveDocument, target: RenderTarget): AdaptiveLayoutPlan {
  const density = deriveAdaptiveDensity(target);
  const geometricScale = clamp(Math.min(target.widthPx / 296, target.heightPx / 152), 0.52, 1.28);
  const fontScale = round(density === 'micro' ? Math.min(0.72, geometricScale) : geometricScale);
  let gapPx = Math.max(2, Math.round((document.gapPx ?? 4) * clamp(geometricScale, 0.5, 1)));
  const paddingXPx = Math.max(3, Math.round((document.paddingXPx ?? 6) * clamp(geometricScale, 0.5, 1)));
  const paddingYPx = Math.max(2, Math.round((document.paddingYPx ?? 4) * clamp(geometricScale, 0.5, 1)));
  const contentWidthPx = Math.max(1, target.widthPx - paddingXPx * 2);
  const decisions: string[] = [];

  let nodes: AdaptivePlannedNode[] = document.nodes.map((node) => {
    const defaults = ROLE_DEFAULTS[node.role];
    const constraints = { ...defaults, ...(node.constraints ?? {}) };
    const densityOmitted = densityOmitRole(node.role, density) && constraints.optional;
    const preferredLines = Math.max(constraints.minLines, constraints.preferredLines);
    const clampLines = densityOmitted ? 0 : Math.max(
      constraints.minLines,
      densityLineCap(node.role, density, preferredLines),
    );
    const baseFontPx = clamp(Math.round(constraints.baseFontPx * fontScale), constraints.minFontPx, Math.ceil(constraints.baseFontPx * 1.3));
    if (densityOmitted) decisions.push(`${node.id}: omitted by ${density} density policy`);
    return refreshNodeGeometry({
      id: node.id,
      role: node.role,
      text: node.text,
      priority: constraints.priority,
      optional: constraints.optional,
      overflow: constraints.overflow,
      visible: !densityOmitted && node.text.trim().length > 0,
      clampLines,
      preferredLines,
      minLines: constraints.minLines,
      estimatedWrappedLines: 0,
      fontPx: baseFontPx,
      lineHeightPx: baseFontPx + 1,
      estimatedHeightPx: 0,
    }, contentWidthPx);
  });

  const availableHeightPx = target.heightPx;
  let estimatedHeightPx = estimatePlanHeight(nodes, paddingYPx, gapPx);

  if (estimatedHeightPx > availableHeightPx && gapPx > 2) {
    const oldGap = gapPx;
    gapPx = 2;
    decisions.push(`gap: compressed ${oldGap}px -> ${gapPx}px`);
    estimatedHeightPx = estimatePlanHeight(nodes, paddingYPx, gapPx);
  }

  const priorityOrder: AdaptivePriority[] = ['low', 'medium', 'high', 'critical'];
  for (const priority of priorityOrder) {
    if (estimatedHeightPx <= availableHeightPx) break;
    for (let index = nodes.length - 1; index >= 0 && estimatedHeightPx > availableHeightPx; index -= 1) {
      const node = nodes[index];
      if (!node.visible || node.priority !== priority || !node.overflow.includes('clamp')) continue;
      while (node.clampLines > node.minLines && estimatedHeightPx > availableHeightPx) {
        const from = node.clampLines;
        node.clampLines -= 1;
        nodes[index] = refreshNodeGeometry(node, contentWidthPx);
        decisions.push(`${node.id}: clamp ${from} -> ${node.clampLines} lines`);
        estimatedHeightPx = estimatePlanHeight(nodes, paddingYPx, gapPx);
      }
    }
  }

  for (const priority of ['low', 'medium', 'high'] as AdaptivePriority[]) {
    if (estimatedHeightPx <= availableHeightPx) break;
    for (let index = nodes.length - 1; index >= 0 && estimatedHeightPx > availableHeightPx; index -= 1) {
      const node = nodes[index];
      if (!node.visible || !node.optional || node.priority !== priority || !node.overflow.includes('omit')) continue;
      nodes[index] = { ...node, visible: false, clampLines: 0, estimatedHeightPx: 0 };
      decisions.push(`${node.id}: omitted to fit available height`);
      estimatedHeightPx = estimatePlanHeight(nodes, paddingYPx, gapPx);
    }
  }

  if (estimatedHeightPx > availableHeightPx) {
    for (let pass = 0; pass < 3 && estimatedHeightPx > availableHeightPx; pass += 1) {
      let changed = false;
      nodes = nodes.map((node) => {
        if (!node.visible) return node;
        const minFontPx = node.role === 'title' ? 10 : node.role === 'body' ? 7 : 6;
        if (node.fontPx <= minFontPx) return node;
        changed = true;
        return refreshNodeGeometry({ ...node, fontPx: node.fontPx - 1 }, contentWidthPx);
      });
      if (!changed) break;
      decisions.push(`font: bounded downscale pass ${pass + 1}`);
      estimatedHeightPx = estimatePlanHeight(nodes, paddingYPx, gapPx);
    }
  }

  const bodyNode = nodes.find((node) => node.role === 'body');
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
    contentUtilization: utilization(estimatedHeightPx, availableHeightPx),
    bodyVisibleLines: bodyNode ? Math.min(bodyNode.clampLines, bodyNode.estimatedWrappedLines) : 0,
    overflowRisk: estimatedHeightPx > availableHeightPx,
    visualGrammar: visualGrammarFor(document),
    regions: null,
    visibleNodeIds: nodes.filter((node) => node.visible && node.clampLines > 0).map((node) => node.id),
    hiddenNodeIds: nodes.filter((node) => !node.visible || node.clampLines <= 0).map((node) => node.id),
    decisions,
    nodes,
  };
}

function roleFontPx(role: AdaptiveTextRole, target: RenderTarget): number {
  const layout = target.newsLayout ?? deriveNewsLayout(target.widthPx, target.heightPx);
  if (role === 'title') return layout.titleFontPx;
  if (role === 'body') return layout.bodyFontPx;
  if (role === 'footer') return layout.footerFontPx;
  if (role === 'eyebrow' || role === 'keyword') return Math.max(8, Math.min(10, layout.bodyFontPx - 1));
  return Math.max(7, Math.min(9, layout.footerFontPx - 2));
}

function roleLineHeightPx(role: AdaptiveTextRole, target: RenderTarget, fontPx: number): number {
  const layout = target.newsLayout ?? deriveNewsLayout(target.widthPx, target.heightPx);
  if (role === 'title') return layout.titleLineHeightPx;
  if (role === 'body') return layout.bodyLineHeightPx;
  if (role === 'footer') return layout.footerLineHeightPx;
  return Math.max(fontPx + 1, Math.round(fontPx * 1.14));
}

function planNewsLayout(document: AdaptiveDocument, target: RenderTarget): AdaptiveLayoutPlan {
  const density = deriveAdaptiveDensity(target);
  const layout = target.newsLayout ?? deriveNewsLayout(target.widthPx, target.heightPx);
  const grammar = visualGrammarFor(document);
  const decisions: string[] = [
    `visual-prior: ${grammar.preset} uses current-news title/body/footer geometry`,
  ];
  const densityScale = clamp(Math.min(target.widthPx / 296, target.heightPx / 152), 0.52, 1.28);
  const bodyPaddingBottomPx = Math.max(1, layout.bodyPaddingTopPx);
  const bodyGapPx = Math.max(2, Math.round(4 * clamp(densityScale, 0.5, 1)));
  const titleContentWidthPx = Math.max(1, target.widthPx - layout.titlePaddingXPx * 2);
  const bodyContentWidthPx = Math.max(1, target.widthPx - layout.bodyPaddingXPx * 2);
  const footerContentWidthPx = Math.max(1, target.widthPx - 8);

  let nodes: AdaptivePlannedNode[] = document.nodes.map((node) => {
    const defaults = ROLE_DEFAULTS[node.role];
    const constraints = { ...defaults, ...(node.constraints ?? {}) };
    const densityOmitted = densityOmitRole(node.role, density) && constraints.optional;
    const preferredLines = Math.max(constraints.minLines, constraints.preferredLines);
    const initialCap = densityOmitted ? 0 : Math.max(
      constraints.minLines,
      densityLineCap(node.role, density, preferredLines),
    );
    const fontPx = roleFontPx(node.role, target);
    const widthPx = node.role === 'title' || node.role === 'eyebrow'
      ? titleContentWidthPx
      : node.role === 'footer'
        ? footerContentWidthPx
        : bodyContentWidthPx;
    if (densityOmitted) decisions.push(`${node.id}: omitted by ${density} density policy`);
    return refreshNodeGeometry({
      id: node.id,
      role: node.role,
      text: node.text,
      priority: constraints.priority,
      optional: constraints.optional,
      overflow: constraints.overflow,
      visible: !densityOmitted && node.text.trim().length > 0,
      clampLines: initialCap,
      preferredLines,
      minLines: constraints.minLines,
      estimatedWrappedLines: 0,
      fontPx,
      lineHeightPx: roleLineHeightPx(node.role, target, fontPx),
      estimatedHeightPx: 0,
    }, widthPx, roleLineHeightPx(node.role, target, fontPx));
  });

  const titleIndex = nodes.findIndex((node) => node.role === 'title');
  const eyebrowIndex = nodes.findIndex((node) => node.role === 'eyebrow');
  const bodyIndex = nodes.findIndex((node) => node.role === 'body');
  const footerIndex = nodes.findIndex((node) => node.role === 'footer');
  const keywordIndex = nodes.findIndex((node) => node.role === 'keyword');
  const metaIndex = nodes.findIndex((node) => node.role === 'meta');

  const titleNode = titleIndex >= 0 ? nodes[titleIndex] : undefined;
  if (!titleNode) throw new Error('Adaptive news document requires a title node');
  const titleCap = density === 'micro' ? 1 : 2;
  titleNode.clampLines = Math.max(1, Math.min(titleCap, titleNode.estimatedWrappedLines));
  nodes[titleIndex] = refreshNodeGeometry(titleNode, titleContentWidthPx, layout.titleLineHeightPx);

  const eyebrowNode = eyebrowIndex >= 0 ? nodes[eyebrowIndex] : undefined;
  const visibleEyebrowHeight = eyebrowNode?.visible ? eyebrowNode.estimatedHeightPx : 0;
  const titleInternalGapPx = visibleEyebrowHeight > 0 ? 2 : 0;
  const titleBannerHeightPx = layout.titlePaddingTopPx
    + visibleEyebrowHeight
    + titleInternalGapPx
    + nodes[titleIndex].estimatedHeightPx
    + layout.titlePaddingBottomPx;

  const footerNode = footerIndex >= 0 ? nodes[footerIndex] : undefined;
  const footerHeightPx = footerNode?.visible ? layout.footerHeightPx : 0;
  const bodyRegionHeightPx = Math.max(0, target.heightPx - titleBannerHeightPx - footerHeightPx);
  const bodyInnerHeightPx = Math.max(0, bodyRegionHeightPx - layout.bodyPaddingTopPx - bodyPaddingBottomPx);

  const auxiliaryIndexes = [keywordIndex, metaIndex].filter((index) => index >= 0);
  const visibleAuxiliary = auxiliaryIndexes
    .map((index) => nodes[index])
    .filter((node) => node.visible && node.clampLines > 0);
  const auxiliaryHeightPx = visibleAuxiliary.reduce((sum, node) => sum + node.estimatedHeightPx, 0)
    + Math.max(0, visibleAuxiliary.length) * bodyGapPx;

  const bodyNode = bodyIndex >= 0 ? nodes[bodyIndex] : undefined;
  let bodyVisibleLines = 0;
  if (bodyNode?.visible) {
    const availableBodyTextHeightPx = Math.max(0, bodyInnerHeightPx - auxiliaryHeightPx);
    const capacity = Math.max(bodyNode.minLines, Math.floor(availableBodyTextHeightPx / layout.bodyLineHeightPx));
    const oldCap = bodyNode.clampLines;
    bodyNode.clampLines = capacity;
    nodes[bodyIndex] = refreshNodeGeometry(bodyNode, bodyContentWidthPx, layout.bodyLineHeightPx);
    bodyVisibleLines = Math.min(nodes[bodyIndex].clampLines, nodes[bodyIndex].estimatedWrappedLines);
    if (capacity > oldCap && nodes[bodyIndex].estimatedWrappedLines > oldCap) {
      decisions.push(`body: expand-to-fill ${oldCap} -> ${capacity} lines from remaining region`);
    }
  }

  const bodyContentHeightPx = (bodyIndex >= 0 ? nodes[bodyIndex].estimatedHeightPx : 0)
    + visibleAuxiliary.reduce((sum, node) => sum + node.estimatedHeightPx, 0)
    + (visibleAuxiliary.length > 0 && bodyIndex >= 0 && nodes[bodyIndex].visible ? visibleAuxiliary.length * bodyGapPx : 0);
  const usedHeightPx = titleBannerHeightPx
    + footerHeightPx
    + layout.bodyPaddingTopPx
    + bodyPaddingBottomPx
    + bodyContentHeightPx;
  const overflowRisk = titleBannerHeightPx + footerHeightPx > target.heightPx
    || (bodyNode?.visible === true && bodyVisibleLines < bodyNode.minLines)
    || auxiliaryHeightPx > bodyInnerHeightPx;

  const regions: AdaptiveLayoutRegions = {
    titleBanner: {
      heightPx: titleBannerHeightPx,
      paddingXPx: layout.titlePaddingXPx,
      paddingTopPx: layout.titlePaddingTopPx,
      paddingBottomPx: layout.titlePaddingBottomPx,
      gapPx: titleInternalGapPx,
    },
    body: {
      heightPx: bodyRegionHeightPx,
      paddingXPx: layout.bodyPaddingXPx,
      paddingTopPx: layout.bodyPaddingTopPx,
      paddingBottomPx: bodyPaddingBottomPx,
      gapPx: bodyGapPx,
    },
    footer: {
      heightPx: footerHeightPx,
      paddingXPx: 4,
      paddingTopPx: 0,
      paddingBottomPx: 0,
      gapPx: 0,
    },
  };

  return {
    version: ADAPTIVE_LAYOUT_VERSION,
    documentId: document.id,
    targetId: target.id,
    density,
    widthPx: target.widthPx,
    heightPx: target.heightPx,
    paddingXPx: 0,
    paddingYPx: 0,
    gapPx: bodyGapPx,
    fontScale: round(densityScale),
    availableHeightPx: target.heightPx,
    estimatedHeightPx: Math.min(target.heightPx, usedHeightPx),
    contentUtilization: utilization(usedHeightPx, target.heightPx),
    bodyVisibleLines,
    overflowRisk,
    visualGrammar: grammar,
    regions,
    visibleNodeIds: nodes.filter((node) => node.visible && node.clampLines > 0).map((node) => node.id),
    hiddenNodeIds: nodes.filter((node) => !node.visible || node.clampLines <= 0).map((node) => node.id),
    decisions,
    nodes,
  };
}

export function planAdaptiveLayout(document: AdaptiveDocument, target: RenderTarget): AdaptiveLayoutPlan {
  if (target.widthPx <= 0 || target.heightPx <= 0) throw new Error('Adaptive target dimensions must be positive');
  const grammar = visualGrammarFor(document);
  return grammar.preset === 'generic-stack'
    ? planGenericLayout(document, target)
    : planNewsLayout(document, target);
}

export interface AdaptiveTextCardContent {
  id?: string;
  visualPreset?: AdaptiveVisualPreset;
  eyebrow?: string;
  title: string;
  body?: string;
  keyword?: string;
  meta?: string;
  footer?: string;
}

export function createAdaptiveTextCardDocument(content: AdaptiveTextCardContent): AdaptiveDocument {
  const node = (id: string, role: AdaptiveTextRole, text: string | undefined): AdaptiveTextNode | null => {
    const normalized = text?.trim();
    return normalized ? { id, kind: 'text', role, text: normalized } : null;
  };
  return {
    id: content.id?.trim() || 'adaptive-text-card',
    visualPreset: content.visualPreset ?? 'generic-stack',
    nodes: [
      node('eyebrow', 'eyebrow', content.eyebrow),
      node('title', 'title', content.title),
      node('body', 'body', content.body),
      node('keyword', 'keyword', content.keyword),
      node('meta', 'meta', content.meta),
      node('footer', 'footer', content.footer),
    ].filter((item): item is AdaptiveTextNode => Boolean(item)),
  };
}
