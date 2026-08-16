export const RESEARCH_TRIAGE_POLICY_VERSION = 'quote0-research-triage/v2';

export interface ResearchSeed {
  title: string;
  content?: string;
  source?: string;
  link?: string;
  category?: string;
}

export interface ResearchTriageInput {
  seed: ResearchSeed;
  manual?: boolean;
  conflict?: boolean;
}

export interface ResearchTriageDecision {
  policyVersion: typeof RESEARCH_TRIAGE_POLICY_VERSION;
  lane: 'direct' | 'research';
  reasons: Array<'manual' | 'conflict' | 'thin' | 'high-risk' | 'rich-low-risk'>;
  signals: {
    contentChars: number;
    thin: boolean;
    rich: boolean;
    highRisk: boolean;
  };
  budget?: {
    maxToolCalls: 6;
    maxPostSeedArtifacts: 3;
    maxPublishableClaims: 4;
    maxFinalizationRetries: 1;
  };
}

const THIN_STUBS = new Set(['点击查看原文', '点击查看原文>', '阅读全文', 'read more', 'read more…']);
const HIGH_RISK_PATTERN = /(?:\bCVE-\d{4}-\d+\b|漏洞|安全更新|安全补丁|远程代码执行|身份验证绕过|认证绕过|actively exploited|zero[- ]day|vulnerabilit|exploit|malware|ransomware|\bsecurity\b|\bcybersecurity\b|法律|法规|监管|诉讼|判决|合规|legal|regulat|lawsuit|court)/iu;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function triageResearchCandidate(input: ResearchTriageInput): ResearchTriageDecision {
  const title = normalize(input.seed?.title);
  const content = normalize(input.seed?.content);
  const category = normalize(input.seed?.category);
  const normalizedContent = content.replace(/[\s>]+$/u, '').toLowerCase();
  const contentChars = [...content].length;
  const thin = !content || THIN_STUBS.has(normalizedContent) || contentChars < 80;
  const rich = contentChars >= 240;
  const highRisk = HIGH_RISK_PATTERN.test(`${title}\n${content}\n${category}`);

  const reasons: ResearchTriageDecision['reasons'] = [];
  if (input.manual) reasons.push('manual');
  if (input.conflict) reasons.push('conflict');
  if (thin) reasons.push('thin');
  if (highRisk) reasons.push('high-risk');

  const shouldResearch = Boolean(input.manual || input.conflict || thin || highRisk);
  if (!shouldResearch && rich) reasons.push('rich-low-risk');

  return {
    policyVersion: RESEARCH_TRIAGE_POLICY_VERSION,
    lane: shouldResearch ? 'research' : 'direct',
    reasons,
    signals: { contentChars, thin, rich, highRisk },
    ...(shouldResearch ? {
      budget: {
        maxToolCalls: 6,
        maxPostSeedArtifacts: 3,
        maxPublishableClaims: 4,
        maxFinalizationRetries: 1,
      },
    } : {}),
  };
}
