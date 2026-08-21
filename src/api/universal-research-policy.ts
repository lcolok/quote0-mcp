import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import type { ResearchRunRecord } from './research-run-store.js';

export const UNIVERSAL_RESEARCH_POLICY_VERSION = 'universal-evidence-research/v1';

export interface UniversalResearchGate {
  schemaVersion: typeof UNIVERSAL_RESEARCH_POLICY_VERSION;
  required: true;
  state: 'pending' | 'ready';
  queuedAt?: string;
  researchRunId?: string;
  researchMode?: string;
  completedAt?: string;
  toolCalls?: number;
  evidenceChars?: number;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function universalResearchEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.QUOTE0_RESEARCH_UNIVERSAL_ENABLED || 'false').toLowerCase() === 'true';
}

export function markUniversalResearchPending<T extends Record<string, any>>(
  processedContent: T,
  now = new Date(),
): T {
  const metadata = asRecord(processedContent.metadata);
  return {
    ...processedContent,
    metadata: {
      ...metadata,
      researchGate: {
        schemaVersion: UNIVERSAL_RESEARCH_POLICY_VERSION,
        required: true,
        state: 'pending',
        queuedAt: now.toISOString(),
      } satisfies UniversalResearchGate,
    },
  };
}

export function researchGateFrom(value: unknown): UniversalResearchGate | undefined {
  const gate = asRecord(asRecord(value).metadata).researchGate;
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return undefined;
  const record = gate as Record<string, unknown>;
  if (record.schemaVersion !== UNIVERSAL_RESEARCH_POLICY_VERSION || record.required !== true) return undefined;
  if (record.state !== 'pending' && record.state !== 'ready') return undefined;
  return record as unknown as UniversalResearchGate;
}

export function markUniversalResearchReady(
  artifact: RenderableDataItem,
  run: Pick<ResearchRunRecord, 'id' | 'triage' | 'runtimeReceipt' | 'evidenceSnapshot' | 'completedAt'>,
  now = new Date(),
): RenderableDataItem {
  const metadata = asRecord(artifact.metadata);
  return {
    ...artifact,
    metadata: {
      ...metadata,
      researchGate: {
        schemaVersion: UNIVERSAL_RESEARCH_POLICY_VERSION,
        required: true,
        state: 'ready',
        researchRunId: run.id,
        ...(run.triage.researchMode ? { researchMode: run.triage.researchMode } : {}),
        completedAt: run.completedAt || now.toISOString(),
        ...(run.runtimeReceipt ? { toolCalls: run.runtimeReceipt.toolCalls } : {}),
        ...(run.evidenceSnapshot ? { evidenceChars: run.evidenceSnapshot.length } : {}),
      } satisfies UniversalResearchGate,
    },
  };
}
