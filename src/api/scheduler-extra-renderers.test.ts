import { describe, expect, it } from 'bun:test';
import { resolveSchedulerExtraRenderers } from './scheduler-extra-renderers.js';

describe('scheduler extra renderers', () => {
  it('producer 永远过滤 legacy local-eink，保留其它额外 renderer', () => {
    expect(resolveSchedulerExtraRenderers('local-eink,json,local-eink', 'producer')).toEqual({
      renderers: ['json'],
      ignored: ['local-eink'],
    });
  });

  it('mixed/未声明角色保持旧行为，避免误伤非 Phase 1 流程', () => {
    expect(resolveSchedulerExtraRenderers('local-eink,json', 'mixed')).toEqual({
      renderers: ['local-eink', 'json'],
      ignored: [],
    });
    expect(resolveSchedulerExtraRenderers(' local-eink ', undefined)).toEqual({
      renderers: ['local-eink'],
      ignored: [],
    });
  });

  it('空值与重复 renderer 被规范化', () => {
    expect(resolveSchedulerExtraRenderers(undefined, 'producer')).toEqual({ renderers: [], ignored: [] });
    expect(resolveSchedulerExtraRenderers('json,json, ,news', 'producer')).toEqual({
      renderers: ['json', 'news'],
      ignored: [],
    });
  });
});
