import { assessSourceEvidence, type EvidenceMode } from './content-quality.js';

export const RESEARCH_TRIAGE_POLICY_VERSION = 'quote0-research-triage/v3';

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
  /** Universal mode admits even adequate/low-risk items into bounded evidence digestion. */
  universal?: boolean;
}

export type ResearchMode = 'digest' | 'recovery' | 'enrichment' | 'verification' | 'exploration';

export interface ResearchBudget {
  maxToolCalls: number;
  maxPostSeedArtifacts: number;
  maxPublishableClaims: number;
  maxFinalizationRetries: number;
  maxEvidenceChars: number;
  targetIndependentClusters: number;
}

export interface ResearchTriageDecision {
  policyVersion: typeof RESEARCH_TRIAGE_POLICY_VERSION;
  lane: 'direct' | 'research';
  reasons: Array<'manual' | 'conflict' | 'universal-evidence' | 'seed-only' | 'sparse-evidence' | 'high-risk' | 'adequate-low-risk'>;
  researchMode?: ResearchMode;
  signals: {
    contentChars: number;
    evidenceMode: EvidenceMode;
    semanticChars: number;
    evidenceAtoms: number;
    hardFactCount: number;
    bodyNoveltyRatio: number;
    highRisk: boolean;
  };
  budget?: ResearchBudget;
}

const HIGH_RISK_PATTERN = /(?:\bCVE-\d{4}-\d+\b|漏洞|安全更新|安全补丁|远程代码执行|身份验证绕过|认证绕过|actively exploited|zero[- ]day|vulnerabilit|exploit|\battacks?\b|\bbreach\b|malware|ransomware|\bsecurity\b|\bcybersecurity\b|法律|法规|监管|诉讼|判决|合规|legal|regulat|lawsuit|court)/iu;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasHighRiskSignal(seed: ResearchSeed): boolean {
  const title = normalize(seed.title);
  const content = normalize(seed.content);
  const category = normalize(seed.category);
  // Only inspect a bounded lead surface. Incidental mentions buried deep in a long
  // article must not consume the high-risk Research bucket.
  const lead = [...content].slice(0, 600).join('');
  return HIGH_RISK_PATTERN.test(`${title}\n${category}\n${lead}`);
}

function budgetFor(mode: ResearchMode): ResearchBudget {
  if (mode === 'recovery') {
    return {
      // Real production seed-only recovery repeatedly reached 10 successful calls while
      // recovering canonical text + targeted corroboration + primary/official evidence.
      // Keep the item budget bounded, but do not discard useful research at 8 post-hoc.
      maxToolCalls: 10,
      maxPostSeedArtifacts: 4,
      maxPublishableClaims: 5,
      maxFinalizationRetries: 1,
      maxEvidenceChars: 8_000,
      targetIndependentClusters: 2,
    };
  }
  if (mode === 'verification') {
    return {
      maxToolCalls: 8,
      maxPostSeedArtifacts: 4,
      maxPublishableClaims: 5,
      maxFinalizationRetries: 1,
      maxEvidenceChars: 8_000,
      targetIndependentClusters: 2,
    };
  }
  if (mode === 'digest') {
    return {
      maxToolCalls: 4,
      maxPostSeedArtifacts: 2,
      maxPublishableClaims: 4,
      maxFinalizationRetries: 2,
      maxEvidenceChars: 5_000,
      // Universal digest is the dominant production lane. A target of one lets
      // a canonical seed crawl satisfy the entire Research phase, which is
      // provenance confirmation rather than information-gain research.
      targetIndependentClusters: 2,
    };
  }
  return {
    maxToolCalls: 6,
    maxPostSeedArtifacts: 3,
    maxPublishableClaims: 4,
    maxFinalizationRetries: 1,
    maxEvidenceChars: 6_000,
    targetIndependentClusters: 1,
  };
}

export function triageResearchCandidate(input: ResearchTriageInput): ResearchTriageDecision {
  const title = normalize(input.seed?.title);
  const content = normalize(input.seed?.content);
  const evidence = assessSourceEvidence({ title, content });
  const highRisk = hasHighRiskSignal(input.seed);

  const reasons: ResearchTriageDecision['reasons'] = [];
  if (input.manual) reasons.push('manual');
  if (input.conflict) reasons.push('conflict');
  if (input.universal) reasons.push('universal-evidence');
  if (evidence.mode === 'seed-only') reasons.push('seed-only');
  if (evidence.mode === 'sparse') reasons.push('sparse-evidence');
  if (highRisk) reasons.push('high-risk');

  const shouldResearch = Boolean(
    input.universal || input.manual || input.conflict || evidence.mode !== 'adequate' || highRisk,
  );
  if (!shouldResearch) reasons.push('adequate-low-risk');

  let researchMode: ResearchMode | undefined;
  if (shouldResearch) {
    if (input.conflict || highRisk) researchMode = 'verification';
    else if (evidence.mode === 'seed-only') researchMode = 'recovery';
    else if (evidence.mode === 'sparse') researchMode = 'enrichment';
    else if (input.universal) researchMode = 'digest';
    else researchMode = 'exploration';
  }

  return {
    policyVersion: RESEARCH_TRIAGE_POLICY_VERSION,
    lane: shouldResearch ? 'research' : 'direct',
    reasons,
    ...(researchMode ? { researchMode, budget: budgetFor(researchMode) } : {}),
    signals: {
      contentChars: [...content].length,
      evidenceMode: evidence.mode,
      semanticChars: evidence.semanticChars,
      evidenceAtoms: evidence.evidenceAtoms,
      hardFactCount: evidence.hardFactCount,
      bodyNoveltyRatio: evidence.bodyNoveltyRatio,
      highRisk,
    },
  };
}
