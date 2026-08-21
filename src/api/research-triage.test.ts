import { describe, expect, it } from 'bun:test';
import { RESEARCH_TRIAGE_POLICY_VERSION, triageResearchCandidate } from './research-triage.js';

describe('research triage', () => {
  it('routes a boilerplate-only seed into deep recovery research without using character count as the reason', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'MCP 新规范取消会话',
        content: '点击查看原文>',
        source: 'InfoQ',
      },
    });

    expect(decision.policyVersion).toBe(RESEARCH_TRIAGE_POLICY_VERSION);
    expect(decision.lane).toBe('research');
    expect(decision.reasons).toContain('seed-only');
    expect(decision.signals.evidenceMode).toBe('seed-only');
    expect(decision.researchMode).toBe('recovery');
    expect(decision.budget).toEqual({
      maxToolCalls: 10,
      maxPostSeedArtifacts: 4,
      maxPublishableClaims: 5,
      maxFinalizationRetries: 1,
      maxEvidenceChars: 8_000,
      targetIndependentClusters: 2,
    });
  });

  it('routes short but meaningful evidence to enrichment rather than treating it as empty', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'FDA新药审批进展',
        content: 'FDA批准新药',
        source: 'wire',
      },
    });

    expect(decision.lane).toBe('research');
    expect(decision.reasons).toContain('sparse-evidence');
    expect(decision.reasons).not.toContain('seed-only');
    expect(decision.researchMode).toBe('enrichment');
    expect(decision.budget?.maxToolCalls).toBe(6);
  });

  it('routes high-risk security items into verification even when source evidence is adequate', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'Apple 修复正在被利用的 Screen Sharing 漏洞 CVE-2026-65400',
        content: '研究人员观察到攻击者利用该问题绕过认证并远程登录受影响的 macOS 主机。Apple 已发布安全更新，并公布受影响系统范围。研究团队另给出临时缓解建议。',
        category: 'technology',
      },
    });

    expect(decision.lane).toBe('research');
    expect(decision.reasons).toContain('high-risk');
    expect(decision.researchMode).toBe('verification');
    expect(decision.budget?.targetIndependentClusters).toBe(2);
  });

  it('treats an explicit English security category as high-risk even without CVE keywords', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: 'Backend engineering interview guide',
        content: '这是一份完整的工程实践指南。文章分三部分讨论访问控制、审计和故障恢复，并给出团队落地建议。',
        category: 'security',
      },
    });

    expect(decision.lane).toBe('research');
    expect(decision.signals.highRisk).toBe(true);
    expect(decision.reasons).toContain('high-risk');
  });

  it('does not promote a deep-body incidental risk word into the high-risk bucket', () => {
    const filler = '这是一篇关于软件团队协作和构建流程的完整分析。'.repeat(30);
    const decision = triageResearchCandidate({
      seed: {
        title: '软件团队如何改进构建流程',
        content: `${filler}文末顺带提到 security control 也是集成变更的一种。`,
        category: 'technology',
      },
    });

    expect(decision.signals.evidenceMode).toBe('adequate');
    expect(decision.signals.highRisk).toBe(false);
    expect(decision.lane).toBe('direct');
  });

  it('keeps adequate low-risk items on the direct lane in legacy sampling mode', () => {
    const decision = triageResearchCandidate({
      seed: {
        title: '普通产品更新',
        content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
        category: 'technology',
      },
    });

    expect(decision.lane).toBe('direct');
    expect(decision.reasons).toEqual(['adequate-low-risk']);
    expect(decision.budget).toBeUndefined();
  });

  it('admits the same adequate low-risk item into a small digest budget in universal mode', () => {
    const decision = triageResearchCandidate({
      universal: true,
      seed: {
        title: '普通产品更新',
        content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
        category: 'technology',
      },
    });

    expect(decision.lane).toBe('research');
    expect(decision.reasons).toContain('universal-evidence');
    expect(decision.researchMode).toBe('digest');
    expect(decision.budget).toEqual({
      maxToolCalls: 4,
      maxPostSeedArtifacts: 2,
      maxPublishableClaims: 4,
      maxFinalizationRetries: 2,
      maxEvidenceChars: 5_000,
      targetIndependentClusters: 1,
    });
  });

  it('lets explicit manual/conflict requests override an adequate seed', () => {
    const content = '这是一条正文充分的普通新闻。消息来源说明事件经过；第二段给出当事方回应；第三段说明后续时间线。';
    const manual = triageResearchCandidate({ seed: { title: '普通新闻', content }, manual: true });
    const conflict = triageResearchCandidate({ seed: { title: '普通新闻', content }, conflict: true });

    expect(manual.lane).toBe('research');
    expect(manual.reasons).toContain('manual');
    expect(manual.researchMode).toBe('exploration');
    expect(conflict.lane).toBe('research');
    expect(conflict.reasons).toContain('conflict');
    expect(conflict.researchMode).toBe('verification');
  });
});
