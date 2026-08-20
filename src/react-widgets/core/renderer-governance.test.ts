import { describe, expect, test } from 'bun:test';
import { EINK_TARGET, LABEL_T20X8_TARGET } from './render-targets.js';
import {
  ADAPTIVE_REFERENCE_RENDERER_VERSION,
  CURRENT_SATORI_RENDERER_VERSION,
  RENDERER_GOVERNANCE_VERSION,
  RENDERER_TRACKS,
  TRMNL_FRAMEWORK_RENDERER_VERSION,
  TRMNL_PIXEL_RENDERER_VERSION,
  TRMNL_PROMOTION_GATE,
  rendererGovernanceForTarget,
} from './renderer-governance.js';

describe('renderer governance', () => {
  test('keeps Satori authoritative, TRMNL canary, and Adaptive v2 frozen reference', () => {
    expect(RENDERER_GOVERNANCE_VERSION).toBe('renderer-governance/v3');
    expect(RENDERER_TRACKS).toEqual(expect.arrayContaining([
      expect.objectContaining({ renderer: CURRENT_SATORI_RENDERER_VERSION, lifecycle: 'authoritative', role: 'production', frozen: false }),
      expect.objectContaining({
        renderer: TRMNL_PIXEL_RENDERER_VERSION,
        layoutEngine: TRMNL_FRAMEWORK_RENDERER_VERSION,
        diagnosticRenderer: TRMNL_FRAMEWORK_RENDERER_VERSION,
        lifecycle: 'canary',
        role: 'candidate',
        frozen: false,
      }),
      expect.objectContaining({ renderer: ADAPTIVE_REFERENCE_RENDERER_VERSION, lifecycle: 'reference', role: 'reference', frozen: true }),
    ]));
  });

  test('does not pretend the legacy Current news projection is authoritative for thermal targets', () => {
    expect(rendererGovernanceForTarget(EINK_TARGET).currentLifecycle).toBe('authoritative');
    expect(rendererGovernanceForTarget(LABEL_T20X8_TARGET).currentLifecycle).toBe('reference');
    expect(rendererGovernanceForTarget(LABEL_T20X8_TARGET).trmnlLifecycle).toBe('canary');
  });

  test('requires evidence before TRMNL promotion', () => {
    expect(TRMNL_PROMOTION_GATE.minHumanReviews).toBeGreaterThanOrEqual(30);
    expect(TRMNL_PROMOTION_GATE.requiresPhysicalReview).toBe(true);
    expect(TRMNL_PROMOTION_GATE.requiresFallbackValidation).toBe(true);
    expect(TRMNL_PROMOTION_GATE.requiresBitplaneSelfCheck).toBe(true);
  });
});
