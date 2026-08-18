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

export const ADAPTIVE_SATORI_RENDERER_VERSION = 'adaptive-satori/v2';

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

function findNode(layoutPlan: AdaptiveLayoutPlan, role: AdaptivePlannedNode['role']): AdaptivePlannedNode | undefined {
  return layoutPlan.nodes.find((node) => node.role === role && node.visible && node.clampLines > 0);
}

function NewsGrammarDocument({
  target,
  layoutPlan,
}: {
  target: RenderTarget;
  layoutPlan: AdaptiveLayoutPlan;
}) {
  const regions = layoutPlan.regions;
  if (!regions) throw new Error('Adaptive news visual grammar requires region geometry');

  const eyebrow = findNode(layoutPlan, 'eyebrow');
  const title = findNode(layoutPlan, 'title');
  const body = findNode(layoutPlan, 'body');
  const keyword = findNode(layoutPlan, 'keyword');
  const meta = findNode(layoutPlan, 'meta');
  const footer = findNode(layoutPlan, 'footer');
  if (!title) throw new Error('Adaptive news visual grammar requires a title node');

  return (
    <div
      style={{
        width: `${target.widthPx}px`,
        height: `${target.heightPx}px`,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
      }}
    >
      <div
        style={{
          width: '100%',
          height: `${regions.titleBanner.heightPx}px`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          paddingLeft: `${regions.titleBanner.paddingXPx}px`,
          paddingRight: `${regions.titleBanner.paddingXPx}px`,
          paddingTop: `${regions.titleBanner.paddingTopPx}px`,
          paddingBottom: `${regions.titleBanner.paddingBottomPx}px`,
          backgroundColor: '#000000',
          color: '#FFFFFF',
        }}
      >
        {eyebrow && (
          <div
            style={{
              display: 'flex',
              flexShrink: 0,
              width: '100%',
              height: `${eyebrow.estimatedHeightPx}px`,
              maxHeight: `${eyebrow.estimatedHeightPx}px`,
              overflow: 'hidden',
              color: '#D8D8D8',
              ...nodeFontStyle(eyebrow),
            }}
          >
            <span>{eyebrow.text}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            width: '100%',
            height: `${title.estimatedHeightPx}px`,
            maxHeight: `${title.estimatedHeightPx}px`,
            marginTop: eyebrow ? `${regions.titleBanner.gapPx}px` : '0px',
            overflow: 'hidden',
            color: '#FFFFFF',
            fontWeight: 'normal',
            wordWrap: 'break-word',
            wordBreak: 'normal',
            whiteSpace: 'normal',
            ...nodeFontStyle(title),
          }}
        >
          <span>{title.text}</span>
        </div>
      </div>

      <div
        style={{
          width: '100%',
          height: `${regions.body.heightPx}px`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          paddingLeft: `${regions.body.paddingXPx}px`,
          paddingRight: `${regions.body.paddingXPx}px`,
          paddingTop: `${regions.body.paddingTopPx}px`,
          paddingBottom: `${regions.body.paddingBottomPx}px`,
          backgroundColor: '#FFFFFF',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {body && (
            <div
              style={{
                display: 'flex',
                width: '100%',
                maxHeight: `${body.clampLines * body.lineHeightPx}px`,
                overflow: 'hidden',
                color: '#333333',
                ...nodeFontStyle(body),
              }}
            >
              <span>{body.text}</span>
            </div>
          )}
        </div>

        {keyword && (
          <div
            style={{
              display: 'flex',
              flexShrink: 0,
              width: '100%',
              height: `${keyword.estimatedHeightPx}px`,
              maxHeight: `${keyword.estimatedHeightPx}px`,
              marginTop: `${regions.body.gapPx}px`,
              overflow: 'hidden',
              color: '#111111',
              fontWeight: 'bold',
              ...nodeFontStyle(keyword),
            }}
          >
            <span>{keyword.text}</span>
          </div>
        )}

        {meta && (
          <div
            style={{
              display: 'flex',
              flexShrink: 0,
              width: '100%',
              height: `${meta.estimatedHeightPx}px`,
              maxHeight: `${meta.estimatedHeightPx}px`,
              marginTop: `${regions.body.gapPx}px`,
              overflow: 'hidden',
              color: '#555555',
              ...nodeFontStyle(meta),
            }}
          >
            <span>{meta.text}</span>
          </div>
        )}
      </div>

      {footer && regions.footer.heightPx > 0 && (
        <div
          style={{
            width: '100%',
            height: `${regions.footer.heightPx}px`,
            display: 'flex',
            flexShrink: 0,
            justifyContent: 'center',
            alignItems: 'center',
            boxSizing: 'border-box',
            overflow: 'hidden',
            paddingLeft: `${regions.footer.paddingXPx}px`,
            paddingRight: `${regions.footer.paddingXPx}px`,
            borderTop: '1px solid rgba(0,0,0,0.12)',
            backgroundColor: '#FFFFFF',
            color: '#333333',
            textAlign: 'center',
            ...nodeFontStyle(footer),
          }}
        >
          <span>{footer.text}</span>
        </div>
      )}
    </div>
  );
}

function GenericStackDocument({
  target,
  layoutPlan,
}: {
  target: RenderTarget;
  layoutPlan: AdaptiveLayoutPlan;
}) {
  const visible = layoutPlan.nodes.filter((node) => node.visible && node.clampLines > 0);
  return (
    <div
      style={{
        width: `${target.widthPx}px`,
        height: `${target.heightPx}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: layoutPlan.visualGrammar.verticalAlign === 'center' ? 'center' : 'flex-start',
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

export function AdaptiveSatoriDocument(props: {
  document: AdaptiveDocument;
  target: RenderTarget;
  layoutPlan?: AdaptiveLayoutPlan;
}) {
  const { document, target } = props;
  const layoutPlan = props.layoutPlan ?? planAdaptiveLayout(document, target);
  return layoutPlan.visualGrammar.titleTreatment === 'inverse-banner'
    ? <NewsGrammarDocument target={target} layoutPlan={layoutPlan} />
    : <GenericStackDocument target={target} layoutPlan={layoutPlan} />;
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
