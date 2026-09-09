import React from 'react';
import type { RenderTarget } from './render-targets.js';
import {
  planAdaptiveLayout,
  type AdaptiveDocument,
  type AdaptiveLayoutPlan,
  type AdaptivePlannedNode,
} from './adaptive-layout.js';
import {
  satoriRenderer,
  type SatoriBaseFontSize,
  type SatoriPipelineMetrics,
} from './satori-renderer.js';
import { selectOptimalFont } from '../smart-font-selector.js';

export const ADAPTIVE_SATORI_RENDERER_VERSION = 'adaptive-satori/v1';

export interface AdaptiveSatoriRenderResult {
  pngBuffer: Buffer;
  target: RenderTarget;
  layoutPlan: AdaptiveLayoutPlan;
  renderMs: number;
  metrics: SatoriPipelineMetrics;
}

function nodeFontStyle(node: AdaptivePlannedNode) {
  const selection = selectOptimalFont(node.fontPx);
  return {
    fontFamily: `FusionPixelFont-${selection.baseFontSize}px`,
    fontSize: `${selection.actualSize}px`,
    lineHeight: `${node.lineHeightPx}px`,
  } as const;
}

function nodeColor(node: AdaptivePlannedNode): string {
  if (node.role === 'meta' || node.role === 'footer' || node.role === 'eyebrow') return '#555555';
  return '#111111';
}

export function AdaptiveSatoriDocument(props: {
  document: AdaptiveDocument;
  target: RenderTarget;
  layoutPlan?: AdaptiveLayoutPlan;
}) {
  const { document, target } = props;
  const layoutPlan = props.layoutPlan ?? planAdaptiveLayout(document, target);
  const visible = layoutPlan.nodes.filter((node) => node.visible && node.clampLines > 0);
  const justifyContent = layoutPlan.density === 'micro' || layoutPlan.density === 'compact'
    ? 'flex-start'
    : 'center';

  return (
    <div
      style={{
        width: `${target.widthPx}px`,
        height: `${target.heightPx}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent,
        alignItems: 'stretch',
        paddingLeft: `${layoutPlan.paddingXPx}px`,
        paddingRight: `${layoutPlan.paddingXPx}px`,
        paddingTop: `${layoutPlan.paddingYPx}px`,
        paddingBottom: `${layoutPlan.paddingYPx}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
      }}
    >
      {visible.map((node, index) => (
        <div
          key={node.id}
          style={{
            display: 'flex',
            flexShrink: 0,
            width: '100%',
            height: `${node.estimatedHeightPx}px`,
            maxHeight: `${node.estimatedHeightPx}px`,
            marginTop: index === 0 ? '0px' : `${layoutPlan.gapPx}px`,
            overflow: 'hidden',
            color: nodeColor(node),
            ...nodeFontStyle(node),
          }}
        >
          <span>{node.text}</span>
        </div>
      ))}
    </div>
  );
}

export function adaptiveSatoriFontBaseSizes(layoutPlan: AdaptiveLayoutPlan): SatoriBaseFontSize[] {
  const sizes = new Set<SatoriBaseFontSize>();
  for (const node of layoutPlan.nodes) {
    if (!node.visible || node.clampLines <= 0) continue;
    sizes.add(selectOptimalFont(node.fontPx).baseFontSize);
  }
  return [...sizes].sort((a, b) => a - b);
}

export async function renderAdaptiveDocumentWithSatori(
  document: AdaptiveDocument,
  target: RenderTarget,
  layoutPlan: AdaptiveLayoutPlan = planAdaptiveLayout(document, target),
): Promise<AdaptiveSatoriRenderResult> {
  if (layoutPlan.documentId !== document.id || layoutPlan.targetId !== target.id) {
    throw new Error('Adaptive Satori layout plan does not match document/target identity');
  }
  const fontBaseSizes = adaptiveSatoriFontBaseSizes(layoutPlan);
  const rendered = await satoriRenderer.renderToImageWithMetrics(
    <AdaptiveSatoriDocument document={document} target={target} layoutPlan={layoutPlan} />,
    { width: target.widthPx, height: target.heightPx, fontBaseSizes },
  );
  return {
    pngBuffer: rendered.pngBuffer,
    target,
    layoutPlan,
    renderMs: rendered.metrics.totalMs,
    metrics: rendered.metrics,
  };
}
