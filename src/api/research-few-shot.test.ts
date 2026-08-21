import { describe, expect, it } from 'bun:test';
import {
  buildNeuromancerEvidenceFinalizationPrompt,
  buildNeuromancerResearchPrompt,
  EINK_NEWS_FEW_SHOT_VERSION,
  RESEARCH_PHASE_A_DONE,
} from './research-few-shot.js';
import { triageResearchCandidate } from './research-triage.js';

describe('Neuromancer research prompts', () => {
  it('turns a seed-only item into a deep recovery playbook instead of a generic six-call search loop', () => {
    const seed = {
      title: 'MCP 新规范取消会话',
      content: '点击查看原文>',
      source: 'InfoQ',
      link: 'https://example.com/mcp',
      category: 'technology',
    };
    const decision = triageResearchCandidate({ seed });
    const prompt = buildNeuromancerResearchPrompt(seed, decision, 'run-123');

    expect(decision.researchMode).toBe('recovery');
    expect(prompt).toContain('Phase A：只负责检索和事实核验');
    expect(prompt).toContain('研究模式：recovery');
    expect(prompt).toContain('最多 10 次工具调用');
    expect(prompt).toContain('seed 之外最多形成 4 个高价值来源制品');
    expect(prompt).toContain('目标独立来源簇至少 2 个');
    expect(prompt).toContain('Canonical');
    expect(prompt).toContain('Provenance');
    expect(prompt).toContain('Gap map');
    expect(prompt).toContain('Corroboration');
    expect(prompt).toContain('Conflict + freshness');
    expect(prompt).toContain('最低覆盖门槛');
    expect(prompt).toContain('至少 1 次 targeted search');
    expect(prompt).toContain('不能因为已经找回正文就提前停止');
    expect(prompt).toContain('Marginal-gain stop');
    expect(prompt).toContain('搜索结果只是线索');
    expect(prompt).toContain(RESEARCH_PHASE_A_DONE);
    expect(prompt).toContain('不要写新闻、不要写 JSON');
  });

  it('refuses to build a research prompt for a direct-lane item in legacy mode', () => {
    const seed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
    };
    const decision = triageResearchCandidate({ seed });
    expect(decision.lane).toBe('direct');
    expect(() => buildNeuromancerResearchPrompt(seed, decision, 'run-direct')).toThrow();
  });

  it('gives adequate universal items a small evidence-digest playbook instead of skipping Research', () => {
    const seed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
      link: 'https://example.com/update',
    };
    const decision = triageResearchCandidate({ seed, universal: true });
    const prompt = buildNeuromancerResearchPrompt(seed, decision, 'run-digest');
    expect(decision.researchMode).toBe('digest');
    expect(prompt).toContain('研究模式：digest');
    expect(prompt).toContain('最多 4 次工具调用');
    expect(prompt).toContain('若 seed 本身就是 primary/official 且正文完整');
    expect(prompt).toContain('不机械耗尽 4 次预算');
  });

  it('makes Phase B a fresh-thread no-tools synthesis over frozen evidence with claim-level conflict discipline', () => {
    const seed = { title: 'MCP 新规范取消会话', content: '点击查看原文>', source: 'InfoQ' };
    const decision = triageResearchCandidate({ seed });
    const prompt = buildNeuromancerEvidenceFinalizationPrompt(
      seed,
      'version=quote0-evidence-packet/v1\n[EVIDENCE 1] tool=crawl\noutput=official evidence',
      'run-123',
      decision,
      ['message 超出容量'],
      { title: 'Direct 草稿', message: 'Direct 中的具体细节只能在证据支持时保留' },
    );
    expect(prompt).toContain('Phase B finalizer');
    expect(prompt).toContain('researchMode=recovery');
    expect(prompt).toContain('绝对禁止调用任何工具');
    expect(prompt).toContain('official evidence');
    expect(prompt).toContain('message 超出容量');
    expect(prompt).toContain(`version=${EINK_NEWS_FEW_SHOT_VERSION}`);
    expect(prompt).toContain('不要编造 usage/token 数值');
    expect(prompt).toContain('单行紧凑 JSON');
    expect(prompt).toContain('sources 总数最多 5');
    expect(prompt).toContain('claims 最多 5');
    expect(prompt).toContain('同一转载链不能当多源确认');
    expect(prompt).toContain('冲突/过时信息');
    expect(prompt).toContain('Direct Draft');
    expect(prompt).toContain('Direct 中的具体细节');
    expect(prompt).toContain('Direct Draft 只是编辑草稿，不是证据');
  });

  it('caps rich seed content at 1000 chars in Phase B while Phase A keeps the full seed', () => {
    const content = '完整事实段落一。完整事实段落二；完整事实段落三。'.repeat(80);
    const seed = { title: '高风险富正文', content, source: 'DEV', category: 'security' };
    const decision = triageResearchCandidate({ seed });
    const researchPrompt = buildNeuromancerResearchPrompt(seed, decision, 'run-rich');
    const finalPrompt = buildNeuromancerEvidenceFinalizationPrompt(seed, 'evidence', 'run-rich', decision);

    expect(researchPrompt).toContain(content);
    expect(finalPrompt).toContain(content.slice(0, 1_000));
    expect(finalPrompt).not.toContain(content.slice(0, 1_001));
    expect(finalPrompt).toContain('最多1000字符正文快照');
  });
});
