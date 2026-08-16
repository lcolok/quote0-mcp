import { describe, expect, it } from 'bun:test';
import { RESEARCH_TRIAGE_POLICY_VERSION, triageResearchCandidate } from './research-triage.js';

describe('research triage', () => {
  it('routes thin RSS stubs into bounded research', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'MCP 新规范取消会话',
        content: '点击查看原文>',
        source: 'InfoQ',
      },
    });

    expect(decision.policyVersion).toBe(RESEARCH_TRIAGE_POLICY_VERSION);
    expect(decision.lane).toBe('research');
    expect(decision.reasons).toContain('thin');
    expect(decision.budget).toEqual({
      maxToolCalls: 6,
      maxPostSeedArtifacts: 3,
      maxPublishableClaims: 4,
      maxFinalizationRetries: 1,
    });
  });

  it('routes high-risk security items even when the seed is not thin', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'Apple 修复正在被利用的 Screen Sharing 漏洞 CVE-2026-65400',
        content: '研究人员观察到攻击者利用该问题绕过认证并远程登录受影响的 macOS 主机，Apple 已发布安全更新。',
        category: 'technology',
      },
    });

    expect(decision.lane).toBe('research');
    expect(decision.reasons).toContain('high-risk');
  });

  it('treats an explicit English security category as high-risk even without CVE keywords', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'Backend engineering interview guide',
        content: '这是一个内容完整但标题本身不包含漏洞关键词的安全工程主题。'.repeat(20),
        category: 'security',
      },
    });

    expect(decision.lane).toBe('research');
    expect(decision.signals.highRisk).toBe(true);
    expect(decision.reasons).toContain('high-risk');
  });

  it('keeps rich low-risk items on the direct lane', () => {
    const content = '这是一条信息已经相对充分的普通产品更新。'.repeat(20);
    const decision = triageResearchCandidate({
      seed: {
        title: '普通产品更新',
        content,
        category: 'technology',
      },
    });

    expect(decision.lane).toBe('direct');
    expect(decision.reasons).toEqual(['rich-low-risk']);
    expect(decision.budget).toBeUndefined();
  });

  it('lets explicit manual/conflict requests override a rich seed', () => {
    const content = '这是一条正文非常充分、默认无需扩展研究的普通新闻。'.repeat(20);
    const manual = triageResearchCandidate({ seed: { title: '普通新闻', content }, manual: true });
    const conflict = triageResearchCandidate({ seed: { title: '普通新闻', content }, conflict: true });

    expect(manual.lane).toBe('research');
    expect(manual.reasons).toContain('manual');
    expect(conflict.lane).toBe('research');
    expect(conflict.reasons).toContain('conflict');
  });
});
