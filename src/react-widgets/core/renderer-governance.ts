import type { RenderTarget } from './render-targets.js';

export const RENDERER_GOVERNANCE_VERSION = 'renderer-governance/v1';
export const TRMNL_FRAMEWORK_RENDERER_VERSION = 'trmnl-framework-browser/v3.2.0+quote0-news-v1';
export const ADAPTIVE_REFERENCE_RENDERER_VERSION = 'adaptive-satori/v2';
export const CURRENT_SATORI_RENDERER_VERSION = 'current-satori-news/v1';
export const TRMNL_COMPARISON_KEY = 'renderer-comparison/trmnl-news-recipe-v1';

export type RendererTrackId = 'current-satori' | 'trmnl-framework' | 'adaptive-v2-reference';
export type RendererLifecycle = 'experimental' | 'canary' | 'preferred' | 'authoritative' | 'reference';

export interface RendererTrackGovernance {
  id: RendererTrackId;
  renderer: string;
  lifecycle: RendererLifecycle;
  role: 'production' | 'candidate' | 'reference';
  frozen: boolean;
  changesPhysicalDelivery: boolean;
  summary: string;
}

export interface RendererTargetGovernance {
  targetId: string;
  currentLifecycle: RendererLifecycle;
  trmnlLifecycle: RendererLifecycle;
  adaptiveReferenceLifecycle: 'reference';
}

export const RENDERER_TRACKS: RendererTrackGovernance[] = [
  {
    id: 'current-satori',
    renderer: CURRENT_SATORI_RENDERER_VERSION,
    lifecycle: 'authoritative',
    role: 'production',
    frozen: false,
    changesPhysicalDelivery: true,
    summary: 'Quote0 已验证的 Satori/Current 主轨；真实 E-Ink 推屏仍以它为权威。',
  },
  {
    id: 'trmnl-framework',
    renderer: TRMNL_FRAMEWORK_RENDERER_VERSION,
    lifecycle: 'canary',
    role: 'candidate',
    frozen: false,
    changesPhysicalDelivery: false,
    summary: '正式第二轨的 Quote0 News Recipe v1；使用 TRMNL Framework 3.2 原生 no-bleed / inverse / top-stretch / flex / text-scale 视觉语法，先经人工 A/B 与真机门控再晋级。',
  },
  {
    id: 'adaptive-v2-reference',
    renderer: ADAPTIVE_REFERENCE_RENDERER_VERSION,
    lifecycle: 'reference',
    role: 'reference',
    frozen: true,
    changesPhysicalDelivery: false,
    summary: '冻结的迁移 reference/oracle；保留用于回归与像素对照，不再继续发展成第三套布局框架。',
  },
];

export function rendererGovernanceForTarget(target: Pick<RenderTarget, 'id' | 'kind'>): RendererTargetGovernance {
  return {
    targetId: target.id,
    currentLifecycle: target.kind === 'eink' ? 'authoritative' : 'reference',
    trmnlLifecycle: 'canary',
    adaptiveReferenceLifecycle: 'reference',
  };
}

export interface RendererPromotionGate {
  minHumanReviews: number;
  requiresNoCriticalOverflow: boolean;
  requiresPhysicalReview: boolean;
  requiresFallbackValidation: boolean;
  preferenceRule: string;
}

export const TRMNL_PROMOTION_GATE: RendererPromotionGate = {
  minHumanReviews: 30,
  requiresNoCriticalOverflow: true,
  requiresPhysicalReview: true,
  requiresFallbackValidation: true,
  preferenceRule: 'candidate_preferred + tie >= current_preferred for the target/content class',
};
