import { describe, expect, it } from 'bun:test';
import {
  buildNeuromancerEvidenceFinalizationPrompt,
  buildNeuromancerResearchPrompt,
  EINK_NEWS_FEW_SHOT_VERSION,
  RESEARCH_PHASE_A_DONE,
} from './research-few-shot.js';
import { triageResearchCandidate } from './research-triage.js';

describe('Neuromancer research prompts', () => {
  it('makes Phase A retrieval-only with bounded budgets and a tiny completion marker', () => {
    const seed = {
      title: 'MCP 新规范取消会话',
      content: '点击查看原文>',
      source: 'InfoQ',
      link: 'https://example.com/mcp',
      category: 'technology',
    };
    const decision = triageResearchCandidate({ seed });
    const prompt = buildNeuromancerResearchPrompt(seed, decision, 'run-123');

    expect(prompt).toContain('Phase A：只负责检索和事实核验');
    expect(prompt).toContain('最多 6 次工具调用');
    expect(prompt).toContain('seed 之外最多形成 3 个高价值来源制品');
    expect(prompt).toContain(RESEARCH_PHASE_A_DONE);
    expect(prompt).toContain('不要写新闻、不要写 JSON');
  });

  it('refuses to build a research prompt for a direct-lane item', () => {
    const seed = { title: '普通产品更新', content: '普通低风险更新内容。'.repeat(40) };
    const decision = triageResearchCandidate({ seed });
    expect(() => buildNeuromancerResearchPrompt(seed, decision, 'run-direct')).toThrow();
  });

  it('makes Phase B a fresh-thread no-tools synthesis over the frozen evidence packet', () => {
    const prompt = buildNeuromancerEvidenceFinalizationPrompt(
      { title: 'MCP 新规范取消会话', content: '点击查看原文>', source: 'InfoQ' },
      'version=quote0-evidence-packet/v1\n[EVIDENCE 1] tool=crawl\noutput=official evidence',
      'run-123',
      ['message 超出容量'],
    );
    expect(prompt).toContain('Phase B finalizer');
    expect(prompt).toContain('绝对禁止调用任何工具');
    expect(prompt).toContain('official evidence');
    expect(prompt).toContain('message 超出容量');
    expect(prompt).toContain(`version=${EINK_NEWS_FEW_SHOT_VERSION}`);
    expect(prompt).toContain('不要编造 usage/token 数值');
    expect(prompt).toContain('单行紧凑 JSON');
    expect(prompt).toContain('sources 总数最多 3');
    expect(prompt).toContain('claims 最多 4');
  });

  it('caps rich seed content at 1000 chars in Phase B while Phase A keeps the full seed', () => {
    const content = 'x'.repeat(1_500);
    const seed = { title: '高风险富正文', content, source: 'DEV', category: 'security' };
    const decision = triageResearchCandidate({ seed });
    const researchPrompt = buildNeuromancerResearchPrompt(seed, decision, 'run-rich');
    const finalPrompt = buildNeuromancerEvidenceFinalizationPrompt(seed, 'evidence', 'run-rich');

    expect(researchPrompt).toContain('x'.repeat(1_500));
    expect(finalPrompt).toContain('x'.repeat(1_000));
    expect(finalPrompt).not.toContain('x'.repeat(1_001));
    expect(finalPrompt).toContain('最多1000字符正文快照');
  });
});
