import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  materializeStructuredResearchFinalization,
  shouldExtendDigestResearch,
  type ResearchRuntimeReceipt,
  type StructuredResearchFinalization,
} from '../src/api/research-canary.js';
import {
  RESEARCH_TRIAGE_POLICY_VERSION,
  triageResearchCandidate,
  type ResearchSeed,
  type ResearchTriageDecision,
} from '../src/api/research-triage.js';
import { canonicalEvidenceUrl, type NeuromancerResearchReceipt } from '../src/api/renderable-news-intake.js';
import type { RenderableDataItem } from '../src/react-widgets/core/modular-architecture.js';

const CORPUS_VERSION = 'quote0-qwen-research-corpus/v1';
const DEFAULT_CORPUS = resolve(process.cwd(), 'testdata', 'quote0-qwen-research-corpus-v1.json');

interface CorpusCase {
  id: string;
  label: string;
  sourceRunId: string;
  trigger: 'manual' | 'inventory-auto';
  expectedMode?: string;
  seed: ResearchSeed;
  triage: ResearchTriageDecision;
  runtime: ResearchRuntimeReceipt;
  evidencePacket: string;
  artifact: RenderableDataItem;
}

interface CorpusFile {
  schemaVersion: typeof CORPUS_VERSION;
  generatedAt: string;
  source: string;
  cases: CorpusCase[];
}

interface CaseCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function ledgerFromPacket(packet: string): Record<string, any> {
  const line = packet.split('\n').find((item) => item.startsWith('ledger='));
  if (!line) throw new Error('Evidence Packet 缺少 ledger= 行');
  const parsed = JSON.parse(line.slice('ledger='.length));
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) throw new Error('Evidence Ledger 格式无效');
  return parsed;
}

function researchReceipt(artifact: RenderableDataItem): NeuromancerResearchReceipt {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const receipt = metadata.researchReceipt;
  if (!isRecord(receipt)) throw new Error('artifact 缺少 researchReceipt');
  return receipt as unknown as NeuromancerResearchReceipt;
}

function canonical(value: string | undefined): string {
  return canonicalEvidenceUrl(cleanString(value)) || cleanString(value);
}

function replayCandidate(caseItem: CorpusCase): StructuredResearchFinalization {
  const receipt = researchReceipt(caseItem.artifact);
  const sources = Array.isArray(receipt.sources) ? receipt.sources : [];
  const claims = Array.isArray(receipt.claims) ? receipt.claims : [];
  const artifactLink = canonical(caseItem.artifact.link);
  const linkedSource = sources.find((source) => canonical(source.url) === artifactLink) || sources[0];
  if (!linkedSource) throw new Error('artifact 没有可映射 link 的 Receipt source');
  const facts = claims
    .filter((claim) => claim.status === 'supported' && cleanString(claim.text) && Array.isArray(claim.sourceIds) && claim.sourceIds.length > 0)
    .map((claim) => ({ text: cleanString(claim.text), evidenceIds: [...claim.sourceIds] }));
  if (!facts.length) throw new Error('artifact 没有 supported claim 可用于 replay');
  const metadata = isRecord(caseItem.artifact.metadata) ? caseItem.artifact.metadata : {};
  const finalizer = isRecord(metadata.researchFinalizer) ? metadata.researchFinalizer : {};
  const telemetry: StructuredResearchFinalization['telemetry'] = {
    mode: 'structured-inference',
    providerId: cleanString(finalizer.providerId) || 'local-qwen',
    model: cleanString(finalizer.model) || 'qwen3.8-27b',
    latencyMs: Number(finalizer.latencyMs || 0),
    attempt: Math.max(1, Number(finalizer.attempt || 1)),
    ...(isRecord(finalizer.usage)
      ? {
          usage: {
            input: Number(finalizer.usage.input || 0),
            output: Number(finalizer.usage.output || 0),
            cacheRead: Number(finalizer.usage.cacheRead || 0),
            total: Number(finalizer.usage.total || 0),
          },
        }
      : {}),
  };
  return {
    candidate: {
      titleCandidates: [caseItem.artifact.title],
      facts,
      linkEvidenceId: linkedSource.id,
    },
    telemetry,
  };
}

function triageInputFor(caseItem: CorpusCase) {
  const reasons = new Set(caseItem.triage.reasons || []);
  return {
    seed: caseItem.seed,
    ...(reasons.has('manual') ? { manual: true } : {}),
    ...(reasons.has('conflict') ? { conflict: true } : {}),
    ...(reasons.has('universal-evidence') ? { universal: true } : {}),
  } as const;
}

function check(name: string, passed: boolean, detail?: string): CaseCheck {
  return { name, passed, ...(detail ? { detail } : {}) };
}

function evaluateCase(caseItem: CorpusCase) {
  const checks: CaseCheck[] = [];
  const ledger = ledgerFromPacket(caseItem.evidencePacket);
  const ledgerIds = new Set((ledger.entries as Array<Record<string, unknown>>).map((entry) => cleanString(entry.id)).filter(Boolean));
  const receipt = researchReceipt(caseItem.artifact);
  const receiptSourceIds = new Set((receipt.sources || []).map((source) => source.id));
  const claimSourceIds = (receipt.claims || []).flatMap((claim) => claim.sourceIds || []);

  checks.push(check('ledger_has_support_entries', ledgerIds.size > 0, `entries=${ledgerIds.size}`));
  checks.push(check(
    'receipt_sources_are_ledger_evidence',
    [...receiptSourceIds].every((id) => ledgerIds.has(id)),
    `receipt=${[...receiptSourceIds].join(',')} ledger=${[...ledgerIds].join(',')}`,
  ));
  checks.push(check(
    'claims_only_reference_receipt_sources',
    claimSourceIds.every((id) => receiptSourceIds.has(id)),
    `claimSourceIds=${[...new Set(claimSourceIds)].join(',')}`,
  ));

  const replayed = materializeStructuredResearchFinalization({
    runId: `corpus-replay-${caseItem.id}`,
    phaseAThreadId: `corpus-thread-${caseItem.id}`,
    seed: caseItem.seed,
    evidencePacket: caseItem.evidencePacket,
    decision: caseItem.triage,
    runtime: caseItem.runtime,
    finalization: replayCandidate(caseItem),
  });
  checks.push(check('server_owned_replay_materializes', Boolean(replayed.artifact), replayed.errors.join('; ')));
  if (replayed.artifact) {
    checks.push(check('title_is_stable', replayed.artifact.title === caseItem.artifact.title, `${replayed.artifact.title} != ${caseItem.artifact.title}`));
    checks.push(check('message_is_stable', replayed.artifact.message === caseItem.artifact.message, 'deterministic fact packing changed'));
    checks.push(check(
      'ownership_is_server',
      isRecord(replayed.artifact.metadata) && replayed.artifact.metadata.researchArtifactOwnership === 'quote0-server/v1',
    ));
    checks.push(check(
      'highlights_remain_server_owned',
      !Array.isArray(replayed.artifact.highlights) || replayed.artifact.highlights.length === 0,
    ));
    if (caseItem.seed.publishTime) {
      checks.push(check(
        'seed_publish_time_is_stable',
        replayed.artifact.publishTime === new Date(caseItem.seed.publishTime).toISOString(),
        `${replayed.artifact.publishTime} != ${caseItem.seed.publishTime}`,
      ));
    }
  }

  const currentDecision = triageResearchCandidate(triageInputFor(caseItem));
  checks.push(check(
    'current_triage_mode_stable',
    !caseItem.expectedMode || currentDecision.researchMode === caseItem.expectedMode,
    `${currentDecision.researchMode || 'direct'} != ${caseItem.expectedMode || 'unspecified'}`,
  ));
  const currentExtension = shouldExtendDigestResearch(caseItem.evidencePacket, caseItem.runtime, currentDecision);

  return {
    id: caseItem.id,
    label: caseItem.label,
    sourceRunId: caseItem.sourceRunId,
    frozenPolicy: caseItem.triage.policyVersion,
    currentPolicy: RESEARCH_TRIAGE_POLICY_VERSION,
    currentMode: currentDecision.researchMode || 'direct',
    currentExtension,
    passed: checks.every((item) => item.passed),
    checks,
  };
}

async function main(): Promise<void> {
  const path = resolve(argValue('corpus') || DEFAULT_CORPUS);
  const raw = JSON.parse(await readFile(path, 'utf8')) as CorpusFile;
  if (raw.schemaVersion !== CORPUS_VERSION) throw new Error(`不支持的 corpus schema: ${raw.schemaVersion}`);
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error('corpus 没有 cases');

  const results = raw.cases.map(evaluateCase);
  const passed = results.filter((item) => item.passed).length;
  const report = {
    schemaVersion: 'quote0-qwen-research-corpus-replay/v1',
    corpusVersion: raw.schemaVersion,
    corpusGeneratedAt: raw.generatedAt,
    currentPolicy: RESEARCH_TRIAGE_POLICY_VERSION,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
