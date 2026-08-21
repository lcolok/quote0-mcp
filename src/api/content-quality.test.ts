import { describe, expect, it } from 'bun:test';
import {
  assessProducedContentQuality,
  assessSourceEvidence,
  contentQualityResearchPriority,
  extractHardFacts,
  isContentQualityHold,
} from './content-quality.js';

describe('content quality source evidence gate', () => {
  it('classifies an InfoQ navigation stub as seed-only because it contains no semantic proposition', () => {
    const source = assessSourceEvidence({
      title: '将可理解性作为架构特性：无法理解的系统无法安全演进',
      content: '点击查看原文>',
    });
    expect(source.mode).toBe('seed-only');
    expect(source.sufficiency).toBe('insufficient');
    expect(source.semanticChars).toBe(0);
    expect(source.placeholderOnly).toBe(true);
    expect(source.reasons).toContain('no-semantic-body');
    expect(source.reasons).toContain('source-body-boilerplate-only');
  });

  it('does not equate a short body with zero evidence', () => {
    const source = assessSourceEvidence({
      title: 'FDA新药审批进展',
      content: 'FDA批准新药',
    });
    expect(source.mode).toBe('sparse');
    expect(source.sufficiency).toBe('limited');
    expect(source.semanticChars).toBeGreaterThan(0);
    expect(source.reasons).not.toContain('no-semantic-body');
  });

  it('can classify a long headline restatement as seed-only even when character count is large', () => {
    const title = '公司宣布新产品计划';
    const source = assessSourceEvidence({
      title,
      content: `${title}${title}${title}${title}${title}${title}`,
    });
    expect(source.evidenceChars).toBeGreaterThan(24);
    expect(source.mode).toBe('seed-only');
    expect(source.reasons).toContain('body-restates-title');
  });

  it('handles English sentence boundaries without mistaking versions/decimals for sentence breaks', () => {
    const source = assessSourceEvidence({
      title: 'Go 1.27 runtime update',
      content: 'Go 1.27 changes runtime scheduling. The compiler reduces redundant work. Teams can upgrade without changing module syntax.',
    });
    expect(source.mode).toBe('adequate');
    expect(source.evidenceAtoms).toBeGreaterThanOrEqual(3);
  });

  it('uses evidence atoms and novelty rather than a 24/120 character cliff', () => {
    const source = assessSourceEvidence({
      title: '火箭完成回收测试',
      content: '火箭完成首次海上回收。公司称助推器状态正常；团队计划检查发动机后决定是否复飞。',
    });
    expect(source.mode).toBe('adequate');
    expect(source.evidenceAtoms).toBeGreaterThanOrEqual(2);
    expect(source.bodyNoveltyRatio).toBeGreaterThan(0);
  });
});

describe('content quality hard-fact guard', () => {
  it('extracts evidence-sensitive dates, percentages, currency and versions', () => {
    const facts = extractHardFacts('Go 1.27 improves 3-10% and costs $7.5B in 2026.');
    expect(facts.map((fact) => `${fact.type}:${fact.value}`)).toEqual(expect.arrayContaining([
      'version:1.27',
      'percent:10%',
      'currency:usd:7500000000',
      'year:2026',
    ]));
  });

  it('rejects the real Go 1.27 failure shape when the generated card adds an unsupported year', () => {
    const assessment = assessProducedContentQuality(
      {
        title: "What's New in Go 1.27: A Developer's Practical Guide",
        content: 'A practical guide to changes in Go 1.27, including compiler, runtime and library improvements. '.repeat(8),
      },
      {
        title: 'Go 1.27发布性能提升',
        message: 'Go 1.27于2024年8月发布，编译运行优化提速10%。',
      },
    );
    expect(assessment.disposition).toBe('hold');
    expect(assessment.recommendation).toBe('research-required');
    expect(assessment.reasons).toContain('unsupported-hard-fact');
    expect(assessment.unsupportedHardFacts).toContain('year:2024');
    expect(assessment.unsupportedHardFacts).toContain('percent:10%');
  });

  it('normalizes equivalent currency forms before judging factual support', () => {
    const assessment = assessProducedContentQuality(
      {
        title: '明道云举办首届 Real AI Contest',
        content: '明道云举办首届 Real AI Contest，现金总奖池 ¥80,000，报名免费。主办方称参赛作品必须已经真实落地。',
      },
      {
        title: '明道云办Real AI大赛',
        message: '明道云举办首届Real AI Contest，免费报名，现金奖池8万元。',
      },
    );
    expect(assessment.unsupportedHardFacts).toEqual([]);
    expect(assessment.disposition).not.toBe('hold');
  });

  it('allows hard facts that are explicitly present in the source evidence', () => {
    const assessment = assessProducedContentQuality(
      {
        title: 'Stripe 以 75 亿美元收购 OpenRouter',
        content: 'Stripe以75亿美元收购OpenRouter。OpenRouter提供统一API接入400余模型。交易双方已公布协议，后续仍需完成交割。',
      },
      {
        title: 'Stripe 75亿收购OpenRouter',
        message: 'Stripe以75亿美元收购OpenRouter，后者提供统一API接入400余模型。',
      },
    );
    expect(assessment.disposition).not.toBe('hold');
    expect(assessment.unsupportedHardFacts).toEqual([]);
  });

  it('holds a polished summary when the source has no proposition beyond boilerplate', () => {
    const assessment = assessProducedContentQuality(
      { title: 'AI爬虫涌入电商，安全防线转向判断', content: '点击查看原文>' },
      { title: 'AI爬虫涌入电商转防御', message: 'AI爬虫大量涌入电商平台，传统拦截式安全防线失效，行业正转向行为判断。' },
    );
    expect(assessment.disposition).toBe('hold');
    expect(assessment.recommendation).toBe('research-required');
  });

  it('marks sparse but meaningful evidence for Research instead of pretending it is either empty or complete', () => {
    const assessment = assessProducedContentQuality(
      { title: 'NASA取消Swift救援任务', content: 'NASA取消Swift救援任务，任务团队将继续监测轨道。' },
      { title: 'NASA取消Swift救援', message: 'NASA取消Swift救援任务，团队将继续监测其轨道。' },
    );
    expect(assessment.mode).toBe('sparse');
    expect(assessment.disposition).toBe('review');
    expect(assessment.recommendation).toBe('research-recommended');
  });
});

describe('content quality metadata helper', () => {
  it('separates mandatory Research from recommended enrichment', () => {
    const hold = { metadata: { contentQuality: { disposition: 'hold', recommendation: 'research-required' } } };
    const review = { metadata: { contentQuality: { disposition: 'review', recommendation: 'research-recommended' } } };
    expect(isContentQualityHold(hold)).toBe(true);
    expect(contentQualityResearchPriority(hold)).toBe(2);
    expect(isContentQualityHold(review)).toBe(false);
    expect(contentQualityResearchPriority(review)).toBe(1);
    expect(contentQualityResearchPriority({})).toBe(0);
  });
});
