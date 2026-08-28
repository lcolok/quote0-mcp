import { createHash } from 'node:crypto';
import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import {
  NEUROMANCER_RESEARCH_RECEIPT_VERSION,
  canonicalEvidenceUrl,
  messageCapacityUnits,
  normalizeNeuromancerFinalArtifact,
  textUnits,
  validateRenderableNews,
  type NeuromancerResearchReceipt,
} from './renderable-news-intake.js';
import {
  EINK_NEWS_FEW_SHOT_VERSION,
  buildNeuromancerEvidenceFinalizationPrompt,
  buildNeuromancerResearchExtensionPrompt,
  buildNeuromancerResearchPrompt,
  buildNeuromancerServerOwnedEditorialPrompt,
  type NeuromancerEditorialDraft,
} from './research-few-shot.js';
import { RESEARCH_TRIAGE_POLICY_VERSION, type ResearchSeed, type ResearchTriageDecision } from './research-triage.js';

export const RESEARCH_CANARY_MODE = 'straylight-jobs-canary/v1';
export const RESEARCH_CANARY_SOURCE_PREFIX = 'quote0-research-canary';
export const RESEARCH_EVIDENCE_PACKET_VERSION = 'quote0-evidence-packet/v1';
export const RESEARCH_EVIDENCE_LEDGER_VERSION = 'quote0-evidence-ledger/v2';
export const QUOTE0_RESEARCH_PROVIDER_ID = 'local-qwen';

export type ResearchCanaryPhase = 'research' | 'finalization';

export interface ResearchCanaryConfig {
  enabled: boolean;
  baseUrl?: string;
  agentId: string;
  researchProviderId: string;
  finalizerProviderId: string;
  structuredFinalizer: boolean;
  bearerToken?: string;
  requestTimeoutMs: number;
}

export interface StraylightCanaryDispatch {
  jobId: string;
  threadId: string;
}

interface StraylightJobSnapshot {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'error' | string;
  threadId: string;
  response?: unknown;
  error?: string;
}

interface StraylightThreadBlock {
  type?: string;
  text?: string;
  interactionStatus?: string;
}

interface StraylightToolCall {
  name?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

interface StraylightThreadTurn {
  participantType?: string;
  state?: string;
  source?: { identity?: string };
  blocks?: StraylightThreadBlock[];
  toolCalls?: StraylightToolCall[];
}

interface StraylightThreadSnapshot {
  turns?: StraylightThreadTurn[];
}

export interface ResearchRuntimeReceipt {
  toolCalls: number;
  searchRequests: number;
  crawlRequests: number;
  failedToolCalls: number;
}

export interface ResearchCanaryInspection {
  status: 'running' | 'research_complete' | 'needs_input' | 'completed' | 'invalid' | 'failed';
  jobStatus?: string;
  artifact?: RenderableDataItem;
  evidencePacket?: string;
  runtime: ResearchRuntimeReceipt;
  phaseRuntime: ResearchRuntimeReceipt;
  errors: string[];
  retryable: boolean;
  jobMissing: boolean;
}

class StraylightRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StraylightRequestError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('STRAYLIGHT_RESEARCH_BASE_URL 必须使用 http/https');
  }
  return parsed.toString().replace(/\/$/u, '');
}

function quote0OnlyResearchProvider(value: string | undefined, envName: string): string {
  const providerId = cleanString(value) || QUOTE0_RESEARCH_PROVIDER_ID;
  if (providerId !== QUOTE0_RESEARCH_PROVIDER_ID) {
    throw new Error(`${envName} 仅允许 ${QUOTE0_RESEARCH_PROVIDER_ID}；Quote0 已禁用其它 Research provider`);
  }
  return providerId;
}

export function getResearchCanaryConfig(env: NodeJS.ProcessEnv = process.env): ResearchCanaryConfig {
  const enabled = String(env.QUOTE0_RESEARCH_CANARY_ENABLED || '').toLowerCase() === 'true';
  const baseUrlRaw = cleanString(env.STRAYLIGHT_RESEARCH_BASE_URL);
  const timeoutRaw = Number.parseInt(env.STRAYLIGHT_RESEARCH_REQUEST_TIMEOUT_MS || '15000', 10);
  return {
    enabled,
    ...(baseUrlRaw ? { baseUrl: normalizeBaseUrl(baseUrlRaw) } : {}),
    agentId: cleanString(env.STRAYLIGHT_RESEARCH_AGENT_ID) || 'pi-mono',
    researchProviderId: quote0OnlyResearchProvider(env.STRAYLIGHT_RESEARCH_PROVIDER_ID, 'STRAYLIGHT_RESEARCH_PROVIDER_ID'),
    finalizerProviderId: quote0OnlyResearchProvider(env.STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID, 'STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID'),
    structuredFinalizer: String(env.QUOTE0_RESEARCH_STRUCTURED_FINALIZER || '').toLowerCase() === 'true',
    ...(cleanString(env.STRAYLIGHT_RESEARCH_BEARER_TOKEN)
      ? { bearerToken: cleanString(env.STRAYLIGHT_RESEARCH_BEARER_TOKEN) }
      : {}),
    requestTimeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(timeoutRaw, 60_000) : 15_000,
  };
}

export function researchCanaryIdentity(runId: string): string {
  return `${RESEARCH_CANARY_SOURCE_PREFIX}:${runId}`;
}

export function researchCanaryFingerprint(seed: ResearchSeed): string {
  return createHash('sha256').update(JSON.stringify({
    title: seed.title,
    link: seed.link || '',
    source: seed.source || '',
    category: seed.category || '',
    publishTime: seed.publishTime || '',
  })).digest('hex');
}

export function researchCanaryIdempotencyKey(seed: ResearchSeed, decision: ResearchTriageDecision, requestKey?: string): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ seed, policyVersion: decision.policyVersion, requestKey: requestKey || '' }))
    .digest('hex');
  return `${RESEARCH_CANARY_MODE}:${hash}`;
}

function headers(config: ResearchCanaryConfig): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Straylight-Provider-Fallback': 'off',
    ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {}),
  };
}

async function requestJson(
  config: ResearchCanaryConfig,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!config.enabled) throw new Error('Quote0 Research Canary 未启用');
  if (!config.baseUrl) throw new Error('STRAYLIGHT_RESEARCH_BASE_URL 未配置');

  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: { ...headers(config), ...(init.headers || {}) },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = isPlainObject(data) ? cleanString(data.error) || cleanString(data.message) : cleanString(data);
    throw new StraylightRequestError(response.status, detail || `Straylight HTTP ${response.status}`);
  }
  return data;
}

export async function dispatchResearchCanary(
  runId: string,
  seed: ResearchSeed,
  decision: ResearchTriageDecision,
  config: ResearchCanaryConfig = getResearchCanaryConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<StraylightCanaryDispatch> {
  const payload = await requestJson(config, '/jobs', {
    method: 'POST',
    headers: {
      'X-Straylight-Max-Tool-Calls': String(decision.budget?.initialToolCalls ?? decision.budget?.maxToolCalls ?? 0),
    },
    body: JSON.stringify({
      message: buildNeuromancerResearchPrompt(seed, decision, runId),
      agentId: config.agentId,
      providerId: config.researchProviderId,
      source: { channel: 'agent', identity: researchCanaryIdentity(runId) },
    }),
  }, fetchImpl);

  if (!isPlainObject(payload)) throw new Error('Straylight /jobs 返回格式无效');
  const jobId = cleanString(payload.jobId);
  const threadId = cleanString(payload.threadId);
  if (!jobId || !threadId) throw new Error('Straylight /jobs 缺少 jobId/threadId');
  return { jobId, threadId };
}

export async function dispatchResearchExtension(
  runId: string,
  threadId: string,
  seed: ResearchSeed,
  evidencePacket: string,
  decision: ResearchTriageDecision,
  plan: { reason?: DigestResearchExtensionDecision['reason'] } = {},
  config: ResearchCanaryConfig = getResearchCanaryConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<StraylightCanaryDispatch> {
  const extensionToolCalls = decision.budget?.extensionToolCalls ?? 0;
  if (decision.researchMode !== 'digest' || extensionToolCalls < 1) {
    throw new Error('Research extension 只允许 staged digest');
  }
  const payload = await requestJson(config, '/jobs', {
    method: 'POST',
    headers: {
      'X-Straylight-Max-Tool-Calls': String(extensionToolCalls),
    },
    body: JSON.stringify({
      threadId,
      message: buildNeuromancerResearchExtensionPrompt(seed, evidencePacket, decision, runId, plan),
      agentId: config.agentId,
      providerId: config.researchProviderId,
      source: { channel: 'agent', identity: researchCanaryIdentity(runId) },
    }),
  }, fetchImpl);

  if (!isPlainObject(payload)) throw new Error('Straylight Research extension /jobs 返回格式无效');
  const jobId = cleanString(payload.jobId);
  const returnedThreadId = cleanString(payload.threadId);
  if (!jobId || !returnedThreadId) throw new Error('Straylight Research extension /jobs 缺少 jobId/threadId');
  if (returnedThreadId !== threadId) throw new Error(`Research extension thread 漂移: ${returnedThreadId} != ${threadId}`);
  return { jobId, threadId: returnedThreadId };
}

/**
 * Phase B intentionally starts a fresh thread. Reusing the Phase-A tool thread was proven
 * unreliable in production: the agent could end after tool calls and a continuation could
 * yield no assistant/tool events. The compact packet is the explicit handoff boundary.
 */
export async function dispatchResearchFinalization(
  runId: string,
  seed: ResearchSeed,
  evidencePacket: string,
  decision: ResearchTriageDecision,
  options: { errors?: string[]; directDraft?: NeuromancerEditorialDraft } = {},
  config: ResearchCanaryConfig = getResearchCanaryConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<StraylightCanaryDispatch> {
  const payload = await requestJson(config, '/jobs', {
    method: 'POST',
    headers: {
      'X-Straylight-Max-Tool-Calls': '0',
    },
    body: JSON.stringify({
      message: buildNeuromancerEvidenceFinalizationPrompt(
        seed,
        evidencePacket,
        runId,
        decision,
        options.errors || [],
        options.directDraft,
      ),
      agentId: config.agentId,
      providerId: config.finalizerProviderId,
      source: { channel: 'agent', identity: researchCanaryIdentity(runId) },
    }),
  }, fetchImpl);

  if (!isPlainObject(payload)) throw new Error('Straylight finalization /jobs 返回格式无效');
  const jobId = cleanString(payload.jobId);
  const threadId = cleanString(payload.threadId);
  if (!jobId || !threadId) throw new Error('Straylight finalization /jobs 缺少 jobId/threadId');
  return { jobId, threadId };
}

export interface StructuredFinalizationTelemetry {
  mode: 'structured-inference';
  providerId: string;
  model: string;
  latencyMs: number;
  finishReason?: string;
  attempt: number;
  totalLatencyMs?: number;
  retryErrors?: string[];
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    total?: number;
  };
}

export interface StructuredResearchFinalization {
  candidate: Record<string, unknown>;
  telemetry: StructuredFinalizationTelemetry;
}

function structuredFinalizationSchema(
  runId: string,
  decision: ResearchTriageDecision,
  evidencePacket: string,
): Record<string, unknown> {
  if (!decision.budget) throw new Error('finalization 缺少 Research budget');
  const maxSources = decision.budget.maxPostSeedArtifacts + 1;
  const maxClaims = decision.budget.maxPublishableClaims;
  const ledger = parseEvidenceLedger(evidencePacket);
  if (decision.policyVersion === RESEARCH_TRIAGE_POLICY_VERSION && ledger?.entries.length) {
    const evidenceIds = ledger.entries.map((entry) => entry.id);
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        titleCandidates: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'string' },
        },
        facts: {
          type: 'array',
          minItems: 1,
          maxItems: maxClaims,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              evidenceIds: {
                type: 'array',
                minItems: 1,
                maxItems: maxSources,
                items: { type: 'string', enum: evidenceIds },
              },
            },
            required: ['text', 'evidenceIds'],
          },
        },
        linkEvidenceId: { type: 'string', enum: evidenceIds },
      },
      required: ['titleCandidates', 'facts', 'linkEvidenceId'],
    };
  }
  const source = {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      url: { type: 'string' },
      title: { type: 'string' },
      role: { type: 'string', enum: ['seed', 'primary', 'official', 'secondary', 'syndicated', 'community'] },
    },
    required: ['id', 'url', 'title', 'role'],
  };
  const claim = {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      sourceIds: { type: 'array', minItems: 1, maxItems: maxSources, items: { type: 'string' } },
      // Final publishable cards never need context/unresolved/conflict claims.
      // If evidence cannot support a claim, the model must omit it instead.
      status: { type: 'string', const: 'supported' },
    },
    required: ['text', 'sourceIds', 'status'],
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', const: `quote0-neuromancer-${runId}` },
      title: { type: 'string' },
      message: { type: 'string' },
      signature: { type: 'string', const: '神经漫游者' },
      source: { type: 'string' },
      publishTime: { type: 'string' },
      category: { type: 'string', const: 'news' },
      link: { type: 'string' },
      highlights: { type: 'array', maxItems: 4, items: { type: 'string' } },
      metadata: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fewShotVersion: { type: 'string', const: EINK_NEWS_FEW_SHOT_VERSION },
          researchReceipt: {
            type: 'object',
            additionalProperties: false,
            properties: {
              schemaVersion: { type: 'string', const: NEUROMANCER_RESEARCH_RECEIPT_VERSION },
              agent: { type: 'string', const: 'neuromancer' },
              sources: { type: 'array', minItems: 1, maxItems: maxSources, items: source },
              claims: { type: 'array', minItems: 1, maxItems: maxClaims, items: claim },
              retrieval: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  status: { type: 'string', enum: ['healthy', 'degraded', 'unknown'] },
                  enginesUsed: { type: 'array', maxItems: 8, items: { type: 'string' } },
                  unavailableEngines: { type: 'array', maxItems: 8, items: { type: 'string' } },
                },
                required: ['status', 'enginesUsed', 'unavailableEngines'],
              },
            },
            required: ['schemaVersion', 'agent', 'sources', 'claims', 'retrieval'],
          },
        },
        required: ['fewShotVersion', 'researchReceipt'],
      },
    },
    required: ['id', 'title', 'message', 'signature', 'source', 'publishTime', 'category', 'link', 'highlights', 'metadata'],
  };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export async function dispatchStructuredResearchFinalization(
  runId: string,
  seed: ResearchSeed,
  evidencePacket: string,
  decision: ResearchTriageDecision,
  options: { errors?: string[]; directDraft?: NeuromancerEditorialDraft; attempt?: number } = {},
  config: ResearchCanaryConfig = getResearchCanaryConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<StructuredResearchFinalization> {
  const useServerOwnedEditorial = decision.policyVersion === RESEARCH_TRIAGE_POLICY_VERSION
    && Boolean(parseEvidenceLedger(evidencePacket)?.entries.length);
  const prompt = useServerOwnedEditorial
    ? buildNeuromancerServerOwnedEditorialPrompt(
        seed,
        evidencePacket,
        decision,
        options.errors || [],
        options.directDraft,
      )
    : buildNeuromancerEvidenceFinalizationPrompt(
        seed,
        evidencePacket,
        runId,
        decision,
        options.errors || [],
        options.directDraft,
      );
  const payload = await requestJson(config, '/inference/structured', {
    method: 'POST',
    body: JSON.stringify({
      providerId: config.finalizerProviderId,
      messages: [{ role: 'user', content: prompt }],
      jsonSchema: {
        name: useServerOwnedEditorial ? 'quote0_server_owned_editorial' : 'quote0_research_final_artifact',
        schema: structuredFinalizationSchema(runId, decision, evidencePacket),
      },
      temperature: 0.1,
      maxTokens: 4_096,
    }),
  }, fetchImpl);
  if (!isPlainObject(payload) || !isPlainObject(payload.parsed)) {
    throw new Error('Straylight structured finalization 返回格式无效');
  }
  const providerId = cleanString(payload.providerId);
  const model = cleanString(payload.model);
  if (providerId !== config.finalizerProviderId) {
    throw new Error(`Straylight structured finalization provider 漂移: ${providerId || 'missing'}`);
  }
  const rawUsage = isPlainObject(payload.usage) ? payload.usage : {};
  const promptTokens = nonNegativeInteger(rawUsage.prompt_tokens);
  const completionTokens = nonNegativeInteger(rawUsage.completion_tokens);
  const totalTokens = nonNegativeInteger(rawUsage.total_tokens);
  const promptDetails = isPlainObject(rawUsage.prompt_tokens_details) ? rawUsage.prompt_tokens_details : {};
  const cachedTokens = nonNegativeInteger(promptDetails.cached_tokens);
  return {
    candidate: payload.parsed,
    telemetry: {
      mode: 'structured-inference',
      providerId,
      model,
      latencyMs: nonNegativeInteger(payload.latencyMs) ?? 0,
      ...(cleanString(payload.finishReason) ? { finishReason: cleanString(payload.finishReason) } : {}),
      attempt: Math.max(1, Math.floor(options.attempt || 1)),
      ...(promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined || cachedTokens !== undefined
        ? {
            usage: {
              ...(promptTokens !== undefined ? { input: promptTokens } : {}),
              ...(completionTokens !== undefined ? { output: completionTokens } : {}),
              ...(cachedTokens !== undefined ? { cacheRead: cachedTokens } : {}),
              ...(totalTokens !== undefined ? { total: totalTokens } : {}),
            },
          }
        : {}),
    },
  };
}

async function tryGetJob(
  jobId: string,
  config: ResearchCanaryConfig,
  fetchImpl: typeof fetch,
): Promise<{ snapshot?: StraylightJobSnapshot; missing: boolean; error?: string }> {
  try {
    const data = await requestJson(config, `/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, fetchImpl);
    return { snapshot: isPlainObject(data) ? data as unknown as StraylightJobSnapshot : undefined, missing: false };
  } catch (error) {
    if (error instanceof StraylightRequestError && error.status === 404) return { missing: true };
    return { missing: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function tryGetThread(
  threadId: string,
  config: ResearchCanaryConfig,
  fetchImpl: typeof fetch,
): Promise<{ snapshot?: StraylightThreadSnapshot; missing: boolean; error?: string }> {
  try {
    const data = await requestJson(config, `/threads/${encodeURIComponent(threadId)}`, { method: 'GET' }, fetchImpl);
    return { snapshot: isPlainObject(data) ? data as unknown as StraylightThreadSnapshot : undefined, missing: false };
  } catch (error) {
    if (error instanceof StraylightRequestError && error.status === 404) return { missing: true };
    return { missing: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function relevantTurns(thread: StraylightThreadSnapshot | undefined, runId: string): StraylightThreadTurn[] {
  const turns = Array.isArray(thread?.turns) ? thread!.turns! : [];
  const identity = researchCanaryIdentity(runId);
  const start = turns.findIndex((turn) => turn.participantType === 'user' && turn.source?.identity === identity);
  if (start < 0) return turns;
  return turns.slice(start);
}

function summarizeRuntime(turns: StraylightThreadTurn[]): ResearchRuntimeReceipt {
  const toolCalls = turns
    .filter((turn) => turn.participantType === 'agent')
    .flatMap((turn) => Array.isArray(turn.toolCalls) ? turn.toolCalls! : []);
  const names = toolCalls.map((tool) => cleanString(tool.name).toLowerCase());
  return {
    toolCalls: toolCalls.length,
    searchRequests: names.filter((name) => name.includes('search')).length,
    crawlRequests: names.filter((name) => name.includes('crawl')).length,
    failedToolCalls: toolCalls.filter((tool) => tool.isError || cleanString(tool.status).toLowerCase() === 'error').length,
  };
}

function addRuntime(a: ResearchRuntimeReceipt | undefined, b: ResearchRuntimeReceipt): ResearchRuntimeReceipt {
  return {
    toolCalls: (a?.toolCalls || 0) + b.toolCalls,
    searchRequests: (a?.searchRequests || 0) + b.searchRequests,
    crawlRequests: (a?.crawlRequests || 0) + b.crawlRequests,
    failedToolCalls: (a?.failedToolCalls || 0) + b.failedToolCalls,
  };
}

export function researchMinimumCoverageErrors(
  runtime: ResearchRuntimeReceipt,
  decision: ResearchTriageDecision,
): string[] {
  const errors: string[] = [];
  // Universal digest used to accept a single canonical crawl as sufficient.
  // Production telemetry showed that this made the dominant lane look like
  // Neuromancer Research while doing no independent freshness/provenance lookup.
  // Keep the bounded four-call budget, but make one targeted search an enforced
  // floor before Phase A can advance to synthesis.
  if (decision.researchMode === 'digest' && runtime.searchRequests < 1) {
    errors.push('digest minimum coverage 未满足: 至少需要 1 次 freshness/provenance targeted search');
  }
  return errors;
}

function hasPendingInteraction(turns: StraylightThreadTurn[]): boolean {
  return turns.some((turn) => turn.state === 'waiting_user'
    || (Array.isArray(turn.blocks) && turn.blocks.some((block) => block.type === 'interaction' && block.interactionStatus !== 'resolved')));
}

function latestAgentTurn(turns: StraylightThreadTurn[]): StraylightThreadTurn | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].participantType === 'agent') return turns[index];
  }
  return undefined;
}

interface ResearchExtensionAuditReceipt {
  reason: DigestResearchExtensionDecision['reason'];
  required: boolean;
  authorizedCandidateUrls?: string[];
  initialToolCalls: number;
  extensionToolCalls: number;
}

function toolCallSucceeded(call: StraylightToolCall): boolean {
  if (call.isError) return false;
  const status = cleanString(call.status).toLowerCase();
  if (status === 'error' || status === 'failed') return false;
  const payload = unwrapToolPayload(call.output);
  const payloadStatus = cleanString(payload?.status).toLowerCase();
  return payloadStatus !== 'error' && payloadStatus !== 'failed';
}

function toolCallCanonicalUrls(call: StraylightToolCall): string[] {
  const payload = unwrapToolPayload(call.output);
  const input = isPlainObject(call.input) ? call.input : {};
  const result = isPlainObject(payload?.result) ? payload.result : {};
  return [...new Set([input.url, payload?.url, result.url]
    .map((value) => canonicalEvidenceUrl(cleanString(value)))
    .filter((value): value is string => Boolean(value)))];
}

function extensionToolCallsForRun(turns: StraylightThreadTurn[], runId: string): StraylightToolCall[] | undefined {
  const identity = researchCanaryIdentity(runId);
  let matchingUserTurns = 0;
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn.participantType === 'user' && turn.source?.identity === identity) {
      matchingUserTurns += 1;
      if (matchingUserTurns === 2) {
        return turns.slice(index + 1)
          .filter((item) => item.participantType === 'agent')
          .flatMap((item) => Array.isArray(item.toolCalls) ? item.toolCalls! : []);
      }
    }
  }
  return undefined;
}

export function researchExtensionOutcomeErrors(
  turns: StraylightThreadTurn[],
  runId: string,
  seed: ResearchSeed,
  receipt: ResearchExtensionAuditReceipt | undefined,
): string[] {
  if (!receipt) return [];
  const calls = extensionToolCallsForRun(turns, runId);
  if (!calls) return ['Research extension 已登记但 thread 中找不到第二个同 identity 用户回合'];
  if (calls.length > receipt.extensionToolCalls) {
    return [`Research extension tool budget 超限: ${calls.length} > ${receipt.extensionToolCalls}`];
  }
  if (receipt.required && calls.length < 1) {
    return [`Required Research extension 未执行工具: reason=${receipt.reason}`];
  }
  if (calls.length === 0) return [];
  const call = calls[0];
  const toolName = cleanString(call.name).toLowerCase();

  if (receipt.reason === 'minimum-search-repair') {
    if (!toolName.includes('search')) return [`minimum-search-repair 必须执行 search，实际为 ${toolName || 'unknown'}`];
    if (!toolCallSucceeded(call)) return ['minimum-search-repair 的 targeted search 未成功'];
    return [];
  }

  if (receipt.reason === 'minimum-evidence-repair') {
    if (!toolName.includes('crawl')) return [`minimum-evidence-repair 必须执行 crawl，实际为 ${toolName || 'unknown'}`];
    if (!toolCallSucceeded(call)) return ['minimum-evidence-repair 的 canonical crawl 未成功'];
    const seedCanonical = canonicalEvidenceUrl(cleanString(seed.link));
    const actualUrls = toolCallCanonicalUrls(call);
    if (!seedCanonical || !actualUrls.includes(seedCanonical)) {
      return [`minimum-evidence-repair 只能恢复 seed canonical: expected=${seedCanonical || 'missing'} actual=${actualUrls.join(',') || 'missing'}`];
    }
    return [];
  }

  if (receipt.reason === 'novel-evidence-candidate') {
    if (!toolName.includes('crawl')) return [`novel-evidence-candidate 只能执行 crawl，实际为 ${toolName || 'unknown'}`];
    if (!toolCallSucceeded(call)) return ['novel-evidence-candidate 的授权 crawl 未成功'];
    const authorized = new Set((receipt.authorizedCandidateUrls || [])
      .map((url) => canonicalEvidenceUrl(cleanString(url)))
      .filter((url): url is string => Boolean(url)));
    const actualUrls = toolCallCanonicalUrls(call);
    if (!actualUrls.some((url) => authorized.has(url))) {
      return [`optional extension crawl 越权: actual=${actualUrls.join(',') || 'missing'} authorized=${[...authorized].join(',') || 'none'}`];
    }
    return [];
  }

  return [];
}

function latestCompletedAgentText(turns: StraylightThreadTurn[]): string {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (turn.participantType !== 'agent' || turn.state !== 'completed' || !Array.isArray(turn.blocks)) continue;
    for (let blockIndex = turn.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = turn.blocks[blockIndex];
      if (block.type === 'text' && cleanString(block.text)) return cleanString(block.text);
    }
  }
  return '';
}

function agentErrorText(turn: StraylightThreadTurn | undefined): string {
  if (!turn || turn.state !== 'error' || !Array.isArray(turn.blocks)) return '';
  return turn.blocks
    .filter((block) => block.type === 'text' || block.type === 'status')
    .map((block) => cleanString(block.text))
    .filter(Boolean)
    .join('\n');
}

function stringifyEvidence(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateEvidence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n[TRUNCATED ${text.length - maxChars} chars]`;
  return `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}

function unwrapToolPayload(output: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(output)) return undefined;
  const content = output.content;
  if (!Array.isArray(content)) return output;
  for (const block of content) {
    if (!isPlainObject(block) || cleanString(block.type) !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed = JSON.parse(block.text);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // Fall back to the outer tool result below.
    }
  }
  return output;
}

function compactToolOutput(call: StraylightToolCall): string {
  const payload = unwrapToolPayload(call.output);
  const toolName = cleanString(call.name).toLowerCase();
  if (!payload) return truncateEvidence(stringifyEvidence(call.output ?? ''), 2_800);

  if (toolName.includes('crawl')) {
    const result = isPlainObject(payload.result) ? payload.result : {};
    const body = cleanString(result.formatted)
      || cleanString(result.text)
      || cleanString(payload.content)
      || stringifyEvidence(Object.keys(result).length > 0 ? result : payload);
    return JSON.stringify({
      status: payload.status,
      url: payload.url || result.url,
      engine: payload.engine,
      result: {
        title: result.title,
        url: result.url || payload.url,
        body: truncateEvidence(body, 2_900),
      },
      ...(payload.error ? { error: payload.error } : {}),
    });
  }

  if (toolName.includes('search')) {
    const results = Array.isArray(payload.results)
      ? payload.results.slice(0, 5).map((item) => {
        if (!isPlainObject(item)) return item;
        return {
          title: item.title,
          url: item.url,
          content: truncateEvidence(cleanString(item.content), 420),
          engine: item.engine,
          score: item.score,
          publishedDate: item.publishedDate,
        };
      })
      : [];
    return JSON.stringify({
      query: payload.query,
      results,
      result_count: payload.result_count,
      actual_engines: payload.actual_engines,
      excluded_engines: payload.excluded_engines,
      engine_status: payload.engine_status,
      degraded: payload.degraded,
    });
  }

  return truncateEvidence(stringifyEvidence(payload), 2_800);
}

/**
 * Deterministic evidence compaction: no LLM. Straylight crawl outputs often duplicate the
 * same document in both formatted/text fields and can exceed megabytes, so unwrap the
 * structured tool envelope, keep one bounded body plus provenance, and cap the whole packet.
 */
function evidenceUrlDigest(value: string): string | undefined {
  const canonical = canonicalEvidenceUrl(value);
  return canonical ? createHash('sha256').update(canonical).digest('hex').slice(0, 24) : undefined;
}

interface EvidenceLedgerEntry {
  id: string;
  evidenceNumber: number;
  canonicalUrl: string;
  urlDigest: string;
  title: string;
  role: 'seed' | 'secondary';
  provenanceCluster: string;
  supportEligible: true;
  engine?: string;
}

interface EvidenceSearchCandidate {
  id: string;
  canonicalUrl: string;
  urlDigest: string;
  title: string;
  domain: string;
  provenanceCluster: string;
  engine?: string;
  score?: number;
  titleMatchedAnchors: string[];
  matchedAnchors: string[];
}

interface EvidenceLedgerV2 {
  version: typeof RESEARCH_EVIDENCE_LEDGER_VERSION;
  entries: EvidenceLedgerEntry[];
  supportUrlDigests: string[];
  toolSummary: {
    searchRequests: number;
    successfulSearchRequests: number;
    crawlRequests: number;
    successfulCrawlRequests: number;
    failedToolCalls: number;
  };
  searchCandidates: EvidenceSearchCandidate[];
  searchCandidateStats: {
    total: number;
    relevant: number;
    rejectedScholarlyNoise: number;
    rejectedLowRelevance: number;
  };
  retrieval: {
    status: 'healthy' | 'degraded' | 'unknown';
    enginesUsed: string[];
    unavailableEngines: string[];
  };
}

function successfulCrawlEvidenceEntries(calls: StraylightToolCall[], seed?: ResearchSeed): EvidenceLedgerEntry[] {
  const seedCanonical = canonicalEvidenceUrl(cleanString(seed?.link));
  const seen = new Set<string>();
  const entries: EvidenceLedgerEntry[] = [];
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (!cleanString(call.name).toLowerCase().includes('crawl') || call.isError) continue;
    const status = cleanString(call.status).toLowerCase();
    if (status === 'error' || status === 'failed') continue;
    const payload = unwrapToolPayload(call.output);
    const payloadStatus = cleanString(payload?.status).toLowerCase();
    if (payloadStatus === 'error' || payloadStatus === 'failed') continue;
    const input = isPlainObject(call.input) ? call.input : {};
    const result = isPlainObject(payload?.result) ? payload.result : {};
    const canonicalUrl = [result.url, payload?.url, input.url]
      .map((value) => canonicalEvidenceUrl(cleanString(value)))
      .find((value): value is string => Boolean(value));
    if (!canonicalUrl || seen.has(canonicalUrl)) continue;
    const crawlSurface = `${cleanString(result.title)}\n${cleanString(result.formatted)}\n${cleanString(result.text)}\n${cleanString(payload?.content)}`.slice(0, 1_200);
    if (/(?:^|\b)(?:403 forbidden|404 not found|access denied|captcha)(?:\b|$)|enable javascript and cookies|just a moment\.\.\.|checking your browser/iu.test(crawlSurface)) {
      continue;
    }
    const urlDigest = evidenceUrlDigest(canonicalUrl);
    if (!urlDigest) continue;
    seen.add(canonicalUrl);
    let title = cleanString(result.title);
    if (!title) {
      try { title = new URL(canonicalUrl).hostname.replace(/^www\./u, ''); } catch { title = canonicalUrl; }
    }
    const engine = cleanString(payload?.engine);
    entries.push({
      id: `E${index + 1}`,
      evidenceNumber: index + 1,
      canonicalUrl,
      urlDigest,
      title: title.slice(0, 180),
      role: seedCanonical && seedCanonical === canonicalUrl ? 'seed' : 'secondary',
      provenanceCluster: evidenceProvenanceCluster(canonicalUrl, seed),
      supportEligible: true,
      ...(engine ? { engine } : {}),
    });
  }
  return entries;
}

const SEARCH_RELEVANCE_STOPWORDS = new Set([
  'about', 'after', 'before', 'from', 'into', 'latest', 'new', 'official', 'overview',
  'that', 'the', 'these', 'this', 'those', 'under', 'using', 'what', 'when', 'where',
  'which', 'while', 'with', 'without', 'your', 'their', 'there', 'have', 'has', 'will', 'would',
  'keep', 'keeping',
]);

function normalizeRelevanceText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function seedRelevanceAnchors(seed?: ResearchSeed): {
  wordAnchors: string[];
  titleWordAnchors: string[];
  hanBigrams: string[];
  scholarly: boolean;
} {
  const title = cleanString(seed?.title).normalize('NFKC');
  const contentLead = [...cleanString(seed?.content)].slice(0, 500).join('').normalize('NFKC');
  const collectWords = (value: string) => [...new Set(
    (value.match(/[\p{L}\p{N}][\p{L}\p{N}._+/-]{2,}/gu) || [])
      .filter((token) => !/\p{Script=Han}/u.test(token))
      .map((token) => normalizeRelevanceText(token))
      .filter((token) => token.length >= 4 && !SEARCH_RELEVANCE_STOPWORDS.has(token)),
  )].slice(0, 40);
  const titleWordAnchors = collectWords(title);
  const wordAnchors = [...new Set([...titleWordAnchors, ...collectWords(contentLead)])].slice(0, 48);
  const hanBigrams = new Set<string>();
  for (const chunk of title.match(/\p{Script=Han}{2,}/gu) || []) {
    const chars = [...chunk];
    for (let index = 0; index < chars.length - 1; index += 1) {
      hanBigrams.add(`${chars[index]}${chars[index + 1]}`);
    }
  }
  let seedDomain = '';
  try { seedDomain = evidenceDomainKey(cleanString(seed?.link)); } catch { /* ignore */ }
  const scholarly = seedDomain === 'arxiv.org'
    || /(?:\barxiv\b|\bpaper\b|\bstudy\b|\bsystem card\b|论文|研究论文|预印本|学术)/iu.test(`${title}\n${contentLead}`);
  return { wordAnchors, titleWordAnchors, hanBigrams: [...hanBigrams].slice(0, 48), scholarly };
}

function searchCandidateLedger(calls: StraylightToolCall[], seed?: ResearchSeed): {
  candidates: EvidenceSearchCandidate[];
  stats: EvidenceLedgerV2['searchCandidateStats'];
} {
  const anchors = seedRelevanceAnchors(seed);
  const seen = new Set<string>();
  const candidates: EvidenceSearchCandidate[] = [];
  const stats = { total: 0, relevant: 0, rejectedScholarlyNoise: 0, rejectedLowRelevance: 0 };

  for (const call of calls) {
    if (!cleanString(call.name).toLowerCase().includes('search') || call.isError) continue;
    const payload = unwrapToolPayload(call.output);
    if (!Array.isArray(payload?.results)) continue;
    for (const raw of payload.results.slice(0, 12)) {
      if (!isPlainObject(raw)) continue;
      const canonicalUrl = canonicalEvidenceUrl(cleanString(raw.url));
      if (!canonicalUrl || seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      stats.total += 1;
      const title = cleanString(raw.title).slice(0, 180);
      const content = cleanString(raw.content).slice(0, 900);
      const engine = cleanString(raw.engine).toLowerCase();
      const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.max(0, raw.score) : undefined;
      const titleNormalized = normalizeRelevanceText(title);
      const combinedNormalized = normalizeRelevanceText(`${title}\n${content}`);
      const titleMatches = anchors.titleWordAnchors.filter((anchor) => titleNormalized.includes(anchor));
      const bodyMatches = anchors.wordAnchors.filter((anchor) => combinedNormalized.includes(anchor));
      const candidateHanBigrams = new Set<string>();
      for (const chunk of title.match(/\p{Script=Han}{2,}/gu) || []) {
        const chars = [...chunk];
        for (let index = 0; index < chars.length - 1; index += 1) candidateHanBigrams.add(`${chars[index]}${chars[index + 1]}`);
      }
      const hanMatches = anchors.hanBigrams.filter((anchor) => candidateHanBigrams.has(anchor));
      const scholarlyNoise = engine === 'arxiv' && !anchors.scholarly;
      if (scholarlyNoise) {
        stats.rejectedScholarlyNoise += 1;
        continue;
      }
      const strongTitleMatch = titleMatches.length >= 1;
      const strongBodyMatch = bodyMatches.length >= 2;
      const relevant = hanMatches.length >= 2
        || (strongTitleMatch && (strongBodyMatch || (score ?? 0) >= 0.3))
        || (strongBodyMatch && (score ?? 0) >= 0.5);
      if (!relevant) {
        stats.rejectedLowRelevance += 1;
        continue;
      }
      const urlDigest = evidenceUrlDigest(canonicalUrl);
      const domain = evidenceDomainKey(canonicalUrl);
      if (!urlDigest || !domain) continue;
      const titleMatchedAnchors = [...new Set([...titleMatches, ...hanMatches])].slice(0, 12);
      const matchedAnchors = [...new Set([...titleMatches, ...bodyMatches, ...hanMatches])].slice(0, 12);
      candidates.push({
        id: `C${candidates.length + 1}`,
        canonicalUrl,
        urlDigest,
        title: title || domain,
        domain,
        provenanceCluster: evidenceProvenanceCluster(canonicalUrl, seed),
        ...(engine ? { engine } : {}),
        ...(score !== undefined ? { score } : {}),
        titleMatchedAnchors,
        matchedAnchors,
      });
      stats.relevant += 1;
    }
  }

  candidates.sort((left, right) => {
    const anchorDelta = right.matchedAnchors.length - left.matchedAnchors.length;
    if (anchorDelta) return anchorDelta;
    return (right.score ?? 0) - (left.score ?? 0);
  });
  return { candidates: candidates.slice(0, 8), stats };
}

function evidenceRetrievalLedger(calls: StraylightToolCall[]): EvidenceLedgerV2['retrieval'] {
  const enginesUsed = new Set<string>();
  const unavailableEngines = new Set<string>();
  let degraded = false;
  for (const call of calls) {
    const payload = unwrapToolPayload(call.output);
    const status = cleanString(call.status).toLowerCase();
    const payloadStatus = cleanString(payload?.status).toLowerCase();
    if (call.isError || status === 'error' || status === 'failed' || payloadStatus === 'error' || payloadStatus === 'failed') degraded = true;
    const engine = cleanString(payload?.engine);
    if (engine) enginesUsed.add(engine);
    if (Array.isArray(payload?.actual_engines)) {
      for (const item of payload.actual_engines) if (typeof item === 'string' && item.trim()) enginesUsed.add(item.trim());
    }
    if (Array.isArray(payload?.results)) {
      for (const item of payload.results) {
        if (isPlainObject(item) && cleanString(item.engine)) enginesUsed.add(cleanString(item.engine));
      }
    }
    if (isPlainObject(payload?.engine_status)) {
      for (const [name, raw] of Object.entries(payload.engine_status)) {
        const value = cleanString(raw).toLowerCase();
        if (value && !['ok', 'healthy', 'success', 'completed'].includes(value)) unavailableEngines.add(name);
      }
    }
  }
  return {
    status: calls.length === 0 ? 'unknown' : degraded ? 'degraded' : 'healthy',
    enginesUsed: [...enginesUsed].sort().slice(0, 8),
    unavailableEngines: [...unavailableEngines].sort().slice(0, 8),
  };
}

function evidenceToolSummary(calls: StraylightToolCall[]): EvidenceLedgerV2['toolSummary'] {
  let searchRequests = 0;
  let successfulSearchRequests = 0;
  let crawlRequests = 0;
  let successfulCrawlRequests = 0;
  let failedToolCalls = 0;
  for (const call of calls) {
    const name = cleanString(call.name).toLowerCase();
    const succeeded = toolCallSucceeded(call);
    if (name.includes('search')) {
      searchRequests += 1;
      if (succeeded) successfulSearchRequests += 1;
    }
    if (name.includes('crawl')) {
      crawlRequests += 1;
      if (succeeded) successfulCrawlRequests += 1;
    }
    if (!succeeded) failedToolCalls += 1;
  }
  return { searchRequests, successfulSearchRequests, crawlRequests, successfulCrawlRequests, failedToolCalls };
}

function buildEvidenceLedger(calls: StraylightToolCall[], seed?: ResearchSeed): EvidenceLedgerV2 {
  const entries = successfulCrawlEvidenceEntries(calls, seed);
  const searchCandidates = searchCandidateLedger(calls, seed);
  return {
    version: RESEARCH_EVIDENCE_LEDGER_VERSION,
    entries,
    supportUrlDigests: entries.map((entry) => entry.urlDigest).sort(),
    toolSummary: evidenceToolSummary(calls),
    searchCandidates: searchCandidates.candidates,
    searchCandidateStats: searchCandidates.stats,
    retrieval: evidenceRetrievalLedger(calls),
  };
}

function parseEvidenceLedger(evidencePacket?: string): EvidenceLedgerV2 | undefined {
  const packet = cleanString(evidencePacket);
  if (!packet) return undefined;
  const ledgerLine = packet.split('\n').find((line) => line.startsWith('ledger='));
  if (!ledgerLine) return undefined;
  try {
    const raw = JSON.parse(ledgerLine.slice('ledger='.length));
    if (!isPlainObject(raw) || raw.version !== RESEARCH_EVIDENCE_LEDGER_VERSION || !Array.isArray(raw.entries)) return undefined;
    const entries: EvidenceLedgerEntry[] = [];
    for (const item of raw.entries) {
      if (!isPlainObject(item)) continue;
      const id = cleanString(item.id);
      const canonicalUrl = canonicalEvidenceUrl(cleanString(item.canonicalUrl));
      const urlDigest = cleanString(item.urlDigest);
      const title = cleanString(item.title);
      const evidenceNumber = nonNegativeInteger(item.evidenceNumber);
      const role = item.role === 'seed' ? 'seed' : 'secondary';
      const provenanceCluster = cleanString(item.provenanceCluster) || (canonicalUrl ? evidenceDomainKey(canonicalUrl) : '');
      if (!id || !canonicalUrl || !provenanceCluster || !/^[a-f0-9]{24}$/.test(urlDigest) || evidenceNumber === undefined || item.supportEligible !== true) continue;
      entries.push({
        id,
        evidenceNumber,
        canonicalUrl,
        urlDigest,
        title: title || canonicalUrl,
        role,
        provenanceCluster,
        supportEligible: true,
        ...(cleanString(item.engine) ? { engine: cleanString(item.engine) } : {}),
      });
    }
    const toolSummaryRaw = isPlainObject(raw.toolSummary) ? raw.toolSummary : {};
    const ledgerCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    const toolSummary: EvidenceLedgerV2['toolSummary'] = {
      searchRequests: ledgerCount(toolSummaryRaw.searchRequests),
      successfulSearchRequests: ledgerCount(toolSummaryRaw.successfulSearchRequests),
      crawlRequests: ledgerCount(toolSummaryRaw.crawlRequests),
      successfulCrawlRequests: ledgerCount(toolSummaryRaw.successfulCrawlRequests),
      failedToolCalls: ledgerCount(toolSummaryRaw.failedToolCalls),
    };
    const searchCandidates: EvidenceSearchCandidate[] = [];
    if (Array.isArray(raw.searchCandidates)) {
      for (const item of raw.searchCandidates.slice(0, 8)) {
        if (!isPlainObject(item)) continue;
        const id = cleanString(item.id);
        const canonicalUrl = canonicalEvidenceUrl(cleanString(item.canonicalUrl));
        const urlDigest = cleanString(item.urlDigest);
        const title = cleanString(item.title);
        const domain = cleanString(item.domain) || (canonicalUrl ? evidenceDomainKey(canonicalUrl) : '');
        const provenanceCluster = cleanString(item.provenanceCluster) || domain;
        const engine = cleanString(item.engine);
        const score = typeof item.score === 'number' && Number.isFinite(item.score) ? Math.max(0, item.score) : undefined;
        const cleanAnchorArray = (value: unknown) => Array.isArray(value)
          ? [...new Set(value.filter((anchor): anchor is string => typeof anchor === 'string').map((anchor) => anchor.trim()).filter(Boolean))].slice(0, 12)
          : [];
        const titleMatchedAnchors = cleanAnchorArray(item.titleMatchedAnchors);
        const matchedAnchors = cleanAnchorArray(item.matchedAnchors);
        if (!id || !canonicalUrl || !domain || !provenanceCluster || !/^[a-f0-9]{24}$/.test(urlDigest)) continue;
        searchCandidates.push({
          id,
          canonicalUrl,
          urlDigest,
          title: title || domain,
          domain,
          provenanceCluster,
          ...(engine ? { engine } : {}),
          ...(score !== undefined ? { score } : {}),
          titleMatchedAnchors,
          matchedAnchors,
        });
      }
    }
    const statsRaw = isPlainObject(raw.searchCandidateStats) ? raw.searchCandidateStats : {};
    const statNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    const searchCandidateStats = {
      total: statNumber(statsRaw.total),
      relevant: statNumber(statsRaw.relevant),
      rejectedScholarlyNoise: statNumber(statsRaw.rejectedScholarlyNoise),
      rejectedLowRelevance: statNumber(statsRaw.rejectedLowRelevance),
    };
    const retrievalRaw = isPlainObject(raw.retrieval) ? raw.retrieval : {};
    const status = ['healthy', 'degraded', 'unknown'].includes(cleanString(retrievalRaw.status))
      ? cleanString(retrievalRaw.status) as EvidenceLedgerV2['retrieval']['status']
      : 'unknown';
    const strings = (value: unknown) => Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 8)
      : [];
    return {
      version: RESEARCH_EVIDENCE_LEDGER_VERSION,
      entries,
      supportUrlDigests: entries.map((entry) => entry.urlDigest).sort(),
      toolSummary,
      searchCandidates,
      searchCandidateStats,
      retrieval: {
        status,
        enginesUsed: strings(retrievalRaw.enginesUsed),
        unavailableEngines: strings(retrievalRaw.unavailableEngines),
      },
    };
  } catch {
    return undefined;
  }
}

function parseSupportEligibleDigests(evidencePacket?: string): Set<string> {
  const ledger = parseEvidenceLedger(evidencePacket);
  if (ledger) return new Set(ledger.supportUrlDigests);
  const packet = cleanString(evidencePacket);
  if (!packet) return new Set();

  // Backward-compatible recovery for Phase-A packets created before Ledger v2.
  // Search snippets are deliberately ignored: only successful crawl inputs can
  // become support-eligible evidence.
  const digests = new Set<string>();
  const pattern = /\[EVIDENCE \d+\] tool=([^\s]+) status=([^\s]+) isError=(true|false)\ninput=([^\n]+)/g;
  for (const match of packet.matchAll(pattern)) {
    if (!match[1].toLowerCase().includes('crawl') || match[3] === 'true') continue;
    if (['error', 'failed'].includes(match[2].toLowerCase())) continue;
    try {
      const input = JSON.parse(match[4]) as { url?: unknown };
      const digest = evidenceUrlDigest(cleanString(input.url));
      if (digest) digests.add(digest);
    } catch {
      // A malformed/truncated legacy input is not support eligible.
    }
  }
  return digests;
}

function evidenceDomainKey(value: string): string {
  try {
    const parts = new URL(value).hostname.replace(/^www\./u, '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const lastTwo = parts.slice(-2).join('.');
    const ccSecondLevel = new Set(['co.uk', 'com.cn', 'com.au', 'co.jp', 'co.kr', 'com.sg', 'com.hk']);
    return ccSecondLevel.has(lastTwo) && parts.length >= 3 ? parts.slice(-3).join('.') : lastTwo;
  } catch {
    return '';
  }
}

const ACCOUNT_HOSTING_DOMAINS = new Set([
  'facebook.com', 'github.com', 'gitlab.com', 'huggingface.co', 'instagram.com',
  'linkedin.com', 'medium.com', 'reddit.com', 'twitter.com', 'x.com', 'youtube.com',
]);

function evidenceProvenanceCluster(value: string, seed?: ResearchSeed): string {
  const domain = evidenceDomainKey(value);
  const seedDomain = evidenceDomainKey(cleanString(seed?.link));
  if (!domain) return '';
  if (!seedDomain) return domain;
  if (domain === seedDomain) return `party:${seedDomain}`;

  const seedBrand = seedDomain.split('.')[0]?.replace(/[^a-z0-9-]/giu, '').toLowerCase() || '';
  if (seedBrand.length < 4) return domain;
  try {
    const parsed = new URL(value);
    const hostnameLabels = parsed.hostname.toLowerCase().split('.').filter(Boolean);
    const pathSegments = parsed.pathname.toLowerCase().split('/').filter(Boolean);
    const hostedAccountMatch = ACCOUNT_HOSTING_DOMAINS.has(domain) && pathSegments.includes(seedBrand);
    if (hostnameLabels.includes(seedBrand) || hostedAccountMatch) {
      return `party:${seedDomain}`;
    }
  } catch {
    return domain;
  }
  return domain;
}

function searchCandidateUrls(evidencePacket: string): string[] {
  const packet = cleanString(evidencePacket);
  if (!packet) return [];
  const candidates = new Set<string>();
  const sections = packet.split(/(?=\n\[EVIDENCE \d+\] tool=)/g);
  for (const section of sections) {
    if (!/^\n?\[EVIDENCE \d+\] tool=search\b/iu.test(section)) continue;
    for (const match of section.matchAll(/https?:\/\/[^"\\\s}\]]+/gu)) {
      const canonical = canonicalEvidenceUrl(match[0].replace(/[),.;]+$/u, ''));
      if (canonical) candidates.add(canonical);
    }
  }
  return [...candidates];
}

const OPTIONAL_EXTENSION_BLOCKED_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com',
  'twitter.com', 'x.com', 'youtube.com',
]);

const OPTIONAL_EXTENSION_TRUSTED_SECONDARY_DOMAINS = new Set([
  'apnews.com', 'arstechnica.com', 'axios.com', 'bbc.com', 'bbc.co.uk', 'bloomberg.com',
  'cnbc.com', 'ft.com', 'reuters.com', 'techcrunch.com', 'theguardian.com',
  'theverge.com', 'wikipedia.org', 'wsj.com',
]);

function optionalExtensionCandidateAllowed(candidate: EvidenceSearchCandidate): boolean {
  if (OPTIONAL_EXTENSION_BLOCKED_DOMAINS.has(candidate.domain)) return false;
  const titleAnchorCount = candidate.titleMatchedAnchors.length;
  if (OPTIONAL_EXTENSION_TRUSTED_SECONDARY_DOMAINS.has(candidate.domain)) {
    return titleAnchorCount >= 1 || candidate.matchedAnchors.length >= 2;
  }
  // Unknown domains need strong title-level entity overlap. Snippet-only mentions are
  // insufficient because they frequently surface aggregators/blogs that merely discuss
  // the same broad topic without adding reliable independent evidence.
  return titleAnchorCount >= 3 && (candidate.score ?? 0) >= 0.3;
}

export interface DigestResearchExtensionDecision {
  extend: boolean;
  required: boolean;
  reason: 'not-staged-digest' | 'initial-budget-not-reached' | 'max-budget-reached' | 'minimum-evidence-repair' | 'minimum-search-repair' | 'coverage-sufficient' | 'no-novel-search-candidate' | 'novel-evidence-candidate';
  candidateUrls: string[];
  existingClusters: string[];
}

export function shouldExtendDigestResearch(
  evidencePacket: string,
  runtime: ResearchRuntimeReceipt,
  decision: ResearchTriageDecision,
): DigestResearchExtensionDecision {
  const budget = decision.budget;
  const initial = budget?.initialToolCalls ?? 0;
  const extension = budget?.extensionToolCalls ?? 0;
  const ledger = parseEvidenceLedger(evidencePacket);
  const existingEntries = ledger?.entries ?? [];
  const existingClusters = [...new Set(existingEntries.map((entry) => entry.provenanceCluster || evidenceDomainKey(entry.canonicalUrl)).filter(Boolean))];
  const base = { candidateUrls: [] as string[], existingClusters, required: false };
  if (decision.researchMode !== 'digest' || initial < 1 || extension < 1 || !budget) {
    return { ...base, extend: false, reason: 'not-staged-digest' };
  }
  if (runtime.toolCalls < initial) return { ...base, extend: false, reason: 'initial-budget-not-reached' };
  if (runtime.toolCalls >= budget.maxToolCalls) return { ...base, extend: false, reason: 'max-budget-reached' };
  if (existingEntries.length === 0) {
    return { ...base, extend: true, required: true, reason: 'minimum-evidence-repair' };
  }
  const requireSuccessfulSearch = decision.policyVersion === RESEARCH_TRIAGE_POLICY_VERSION;
  const successfulSearchRequests = ledger?.toolSummary.successfulSearchRequests ?? 0;
  if ((requireSuccessfulSearch && successfulSearchRequests < 1) || (!requireSuccessfulSearch && runtime.searchRequests < 1)) {
    return { ...base, extend: true, required: true, reason: 'minimum-search-repair' };
  }
  if (existingClusters.length >= budget.targetIndependentClusters) {
    return { ...base, extend: false, reason: 'coverage-sufficient' };
  }

  const crawled = new Set(existingEntries.map((entry) => entry.canonicalUrl));
  const existingClusterSet = new Set(existingClusters);
  const relevanceGoverned = Boolean(ledger && (ledger.searchCandidateStats.total > 0 || ledger.searchCandidates.length > 0));
  const discoveredCandidates = relevanceGoverned
    ? ledger!.searchCandidates
        .filter(optionalExtensionCandidateAllowed)
        .map((candidate) => candidate.canonicalUrl)
    : searchCandidateUrls(evidencePacket);
  const candidateUrls = discoveredCandidates.filter((url) => {
    if (crawled.has(url)) return false;
    const candidate = ledger?.searchCandidates.find((item) => item.canonicalUrl === url);
    const cluster = candidate?.provenanceCluster || evidenceDomainKey(url);
    return Boolean(cluster) && !existingClusterSet.has(cluster);
  });
  if (!candidateUrls.length) {
    return { ...base, extend: false, reason: 'no-novel-search-candidate' };
  }
  return {
    extend: true,
    required: false,
    reason: 'novel-evidence-candidate',
    candidateUrls: candidateUrls.slice(0, 5),
    existingClusters,
  };
}

function evidenceGroundingErrors(rawReceipt: Record<string, unknown>, evidencePacket?: string): string[] {
  const supportEligible = parseSupportEligibleDigests(evidencePacket);
  const rawSources = Array.isArray(rawReceipt.sources) ? rawReceipt.sources : [];
  const sourceDigests = new Map<string, string>();
  for (const rawSource of rawSources) {
    if (!isPlainObject(rawSource)) continue;
    const id = cleanString(rawSource.id);
    const digest = evidenceUrlDigest(cleanString(rawSource.url));
    if (id && digest) sourceDigests.set(id, digest);
  }

  const errors: string[] = [];
  const rawClaims = Array.isArray(rawReceipt.claims) ? rawReceipt.claims : [];
  for (const [index, rawClaim] of rawClaims.entries()) {
    if (!isPlainObject(rawClaim) || cleanString(rawClaim.status) !== 'supported') continue;
    const sourceIds = Array.isArray(rawClaim.sourceIds)
      ? rawClaim.sourceIds.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : [];
    for (const sourceId of sourceIds) {
      const digest = sourceDigests.get(sourceId);
      if (!digest || !supportEligible.has(digest)) {
        errors.push(`Research claim[${index}] sourceId=${sourceId} 未经过成功 crawl/snapshot；search snippet 只能作为线索，不能支撑 supported claim`);
      }
    }
  }
  return errors;
}

export function buildResearchEvidencePacket(
  turns: StraylightThreadTurn[],
  maxPacketChars = 6_000,
  seed?: ResearchSeed,
): string {
  const MAX_PACKET_CHARS = Math.max(2_000, Math.min(12_000, Math.round(maxPacketChars)));
  const calls = turns
    .filter((turn) => turn.participantType === 'agent')
    .flatMap((turn) => Array.isArray(turn.toolCalls) ? turn.toolCalls! : []);
  const ledger = JSON.stringify(buildEvidenceLedger(calls, seed));

  const chunks: string[] = [`version=${RESEARCH_EVIDENCE_PACKET_VERSION}\nledger=${ledger}`];
  let used = chunks[0].length;
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const remainingCalls = calls.length - index;
    const remainingChars = Math.max(0, MAX_PACKET_CHARS - used);
    const callBudget = Math.floor(remainingChars / remainingCalls);
    const input = truncateEvidence(stringifyEvidence(call.input ?? '').trim(), 420);
    const header = `\n[EVIDENCE ${index + 1}] tool=${cleanString(call.name) || 'unknown'} status=${cleanString(call.status) || 'unknown'} isError=${Boolean(call.isError)}`;
    const inputLine = input ? `\ninput=${input}` : '';
    const outputPrefix = '\noutput=';
    const mandatoryChars = header.length + inputLine.length + outputPrefix.length;
    const outputBudget = Math.max(80, callBudget - mandatoryChars);
    const compactedOutput = compactToolOutput(call).trim() || '[empty]';
    const output = truncateEvidence(compactedOutput, outputBudget);
    let chunk = `${header}${inputLine}${outputPrefix}${output}`;
    if (chunk.length > callBudget) chunk = truncateEvidence(chunk, callBudget);
    chunks.push(chunk);
    used += chunk.length;
  }
  if (calls.length === 0) chunks.push('\n[NO TOOL EVIDENCE CAPTURED]');
  return chunks.join('');
}

function parseStrictJsonObject(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') throw new Error('最终响应不是 JSON object/string');
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error('最终响应必须只包含一个 JSON object');
  const parsed = JSON.parse(trimmed);
  if (!isPlainObject(parsed)) throw new Error('最终响应 JSON 顶层必须是 object');
  return parsed;
}

function seedReceipt(seed: ResearchSeed): NonNullable<NeuromancerResearchReceipt['seed']> {
  const content = cleanString(seed.content).slice(0, 1_000);
  return {
    title: seed.title.trim(),
    ...(content ? { content } : {}),
    ...(cleanString(seed.source) ? { source: cleanString(seed.source) } : {}),
    ...(cleanString(seed.link) ? { link: cleanString(seed.link) } : {}),
    ...(cleanString(seed.publishTime) && !Number.isNaN(Date.parse(cleanString(seed.publishTime)))
      ? { publishTime: new Date(cleanString(seed.publishTime)).toISOString() }
      : {}),
  };
}

function cleanFactSentence(value: unknown): string {
  return cleanString(value).replace(/[。；;\s]+$/u, '').trim();
}

function chooseRenderableTitle(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const candidates = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  for (const cap of [22, 28, 32]) {
    const candidate = candidates.find((item) => textUnits(item) <= cap);
    if (candidate) return candidate;
  }
  return undefined;
}

function sourceLabelFromEvidence(entries: EvidenceLedgerEntry[]): string {
  const labels: string[] = [];
  for (const entry of entries) {
    const label = evidenceDomainKey(entry.canonicalUrl) || entry.title;
    if (!label || labels.includes(label)) continue;
    const next = [...labels, label].join('/');
    if (textUnits(next) > 36) break;
    labels.push(label);
  }
  return labels.join('/') || 'Research';
}

function materializeServerOwnedEditorialArtifact(input: {
  runId: string;
  phaseAThreadId: string;
  seed: ResearchSeed;
  evidencePacket: string;
  decision: ResearchTriageDecision;
  runtime: ResearchRuntimeReceipt;
  finalization: StructuredResearchFinalization;
}): { artifact?: RenderableDataItem; errors: string[]; policyViolation: boolean } {
  const { candidate, telemetry } = input.finalization;
  const ledger = parseEvidenceLedger(input.evidencePacket);
  const policyErrors: string[] = [];
  const errors: string[] = [];
  const budget = input.decision.budget;
  if (!budget) policyErrors.push('Research decision 缺少 budget');
  if (budget && input.runtime.toolCalls > budget.maxToolCalls) {
    policyErrors.push(`Research tool budget 超限: ${input.runtime.toolCalls} > ${budget.maxToolCalls}`);
  }
  if (!ledger?.entries.length) {
    policyErrors.push(`Research ${RESEARCH_TRIAGE_POLICY_VERSION} 缺少 ${RESEARCH_EVIDENCE_LEDGER_VERSION} 可支持证据`);
    return { errors: policyErrors, policyViolation: true };
  }

  const title = chooseRenderableTitle(candidate.titleCandidates);
  if (!title) errors.push('titleCandidates 没有任何候选满足 32 display units 上限');
  const entryById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const rawFacts = Array.isArray(candidate.facts) ? candidate.facts : [];
  if (rawFacts.length < 1) errors.push('facts 至少 1 项');
  if (budget && rawFacts.length > budget.maxPublishableClaims) {
    policyErrors.push(`Research fact budget 超限: ${rawFacts.length} > ${budget.maxPublishableClaims}`);
  }

  const validFacts: Array<{ text: string; evidenceIds: string[] }> = [];
  for (const [index, rawFact] of rawFacts.entries()) {
    if (!isPlainObject(rawFact)) {
      errors.push(`facts[${index}] 必须是 object`);
      continue;
    }
    const text = cleanFactSentence(rawFact.text);
    const evidenceIds = Array.isArray(rawFact.evidenceIds)
      ? [...new Set(rawFact.evidenceIds.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
      : [];
    if (!text) errors.push(`facts[${index}].text 不能为空`);
    if (!evidenceIds.length) errors.push(`facts[${index}].evidenceIds 至少 1 项`);
    for (const evidenceId of evidenceIds) {
      if (!entryById.has(evidenceId)) errors.push(`facts[${index}] 引用了未知或不可支持 Evidence ID: ${evidenceId}`);
    }
    if (text && evidenceIds.length && evidenceIds.every((id) => entryById.has(id))) validFacts.push({ text, evidenceIds });
  }

  if (policyErrors.length || errors.length || !title) {
    return { errors: [...policyErrors, ...errors], policyViolation: policyErrors.length > 0 };
  }

  const capacity = messageCapacityUnits(title);
  const selectedFacts: Array<{ text: string; evidenceIds: string[] }> = [];
  for (const fact of validFacts) {
    const candidateMessage = `${[...selectedFacts.map((item) => item.text), fact.text].join('；')}。`;
    if (textUnits(candidateMessage) <= capacity) selectedFacts.push(fact);
  }
  if (!selectedFacts.length) {
    return {
      errors: [`facts 中没有完整事实句能装入当前 ${capacity} display units 正文容量；请缩短最高优先事实句`],
      policyViolation: false,
    };
  }
  const message = `${selectedFacts.map((item) => item.text).join('；')}。`;

  const usedEvidenceIds: string[] = [];
  for (const fact of selectedFacts) {
    for (const id of fact.evidenceIds) if (!usedEvidenceIds.includes(id)) usedEvidenceIds.push(id);
  }
  const sources = usedEvidenceIds.map((id) => entryById.get(id)!).filter(Boolean);
  const sourceIds = new Set(usedEvidenceIds);
  const requestedLinkId = cleanString(candidate.linkEvidenceId);
  const linkEntry = sourceIds.has(requestedLinkId) ? entryById.get(requestedLinkId) : sources[0];
  if (!linkEntry) {
    return { errors: ['最终 artifact 缺少可用 link evidence'], policyViolation: false };
  }

  const seedPublishTime = cleanString(input.seed.publishTime);
  const publishTimeFromSeed = seedPublishTime && !Number.isNaN(Date.parse(seedPublishTime));
  const publishTime = publishTimeFromSeed
    ? new Date(seedPublishTime).toISOString()
    : new Date().toISOString();
  const publishTimeSource = publishTimeFromSeed ? 'seed' : 'research-completion';

  const reportedTokens = telemetry.usage;
  const receipt: NeuromancerResearchReceipt = {
    schemaVersion: NEUROMANCER_RESEARCH_RECEIPT_VERSION,
    agent: 'neuromancer',
    threadId: input.phaseAThreadId,
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    seed: seedReceipt(input.seed),
    sources: sources.map((entry) => ({
      id: entry.id,
      url: entry.canonicalUrl,
      title: entry.title,
      role: entry.role,
    })),
    claims: selectedFacts.map((fact) => ({
      text: fact.text,
      sourceIds: fact.evidenceIds,
      status: 'supported',
    })),
    retrieval: ledger.retrieval,
    usage: {
      providerReportedTokens: reportedTokens
        ? { status: 'reported', ...reportedTokens }
        : { status: 'unavailable' },
      llmCalls: Math.max(1, telemetry.attempt),
      toolCalls: input.runtime.toolCalls,
      searchRequests: input.runtime.searchRequests,
      crawlRequests: input.runtime.crawlRequests,
    },
  };
  const artifactCandidate: RenderableDataItem = {
    id: `quote0-neuromancer-${input.runId}`,
    title,
    message,
    signature: '神经漫游者',
    source: sourceLabelFromEvidence(sources),
    publishTime,
    category: 'news',
    link: linkEntry.canonicalUrl,
    highlights: [],
    metadata: {
      fewShotVersion: EINK_NEWS_FEW_SHOT_VERSION,
      researchReceipt: receipt,
      researchFinalizer: telemetry,
      researchArtifactOwnership: 'quote0-server/v1',
      publishTimeSource,
    },
  };
  const validation = validateRenderableNews(artifactCandidate);
  if (!validation.ok) return { errors: validation.errors, policyViolation: false };
  return { artifact: validation.data, errors: [], policyViolation: false };
}

function materializeArtifact(
  candidate: Record<string, unknown>,
  seed: ResearchSeed,
  threadId: string,
  jobId: string,
  runtime: ResearchRuntimeReceipt,
  decision: ResearchTriageDecision,
  evidencePacket?: string,
  finalizerTelemetry?: StructuredFinalizationTelemetry,
): { artifact?: RenderableDataItem; errors: string[]; policyViolation: boolean } {
  const normalizedCandidate = normalizeNeuromancerFinalArtifact(candidate) as Record<string, unknown>;
  const metadata = isPlainObject(normalizedCandidate.metadata) ? { ...normalizedCandidate.metadata } : {};
  const rawReceipt = isPlainObject(metadata.researchReceipt) ? metadata.researchReceipt : {};
  const rawSources = Array.isArray(rawReceipt.sources) ? rawReceipt.sources : [];
  const rawClaims = Array.isArray(rawReceipt.claims) ? rawReceipt.claims : [];
  const policyErrors: string[] = [];
  const budget = decision.budget;
  if (!budget) policyErrors.push('Research decision 缺少 budget');
  const toolCap = budget?.maxToolCalls ?? 0;
  const sourceCap = budget ? budget.maxPostSeedArtifacts + 1 : 0;
  const claimCap = budget?.maxPublishableClaims ?? 0;
  if (runtime.toolCalls > toolCap) policyErrors.push(`Research tool budget 超限: ${runtime.toolCalls} > ${toolCap}`);
  if (rawSources.length > sourceCap) policyErrors.push(`Research source artifact budget 超限: ${rawSources.length} > ${sourceCap}`);
  if (rawClaims.length > claimCap) policyErrors.push(`Research claim budget 超限: ${rawClaims.length} > ${claimCap}`);

  const reportedTokens = finalizerTelemetry?.usage;
  const receipt = {
    ...rawReceipt,
    schemaVersion: NEUROMANCER_RESEARCH_RECEIPT_VERSION,
    agent: 'neuromancer',
    threadId,
    runId: jobId,
    generatedAt: new Date().toISOString(),
    seed: seedReceipt(seed),
    // Tool accounting is runtime-derived. Structured Phase B additionally exposes
    // real provider token telemetry; model-authored usage is always discarded.
    usage: {
      providerReportedTokens: reportedTokens
        ? { status: 'reported', ...reportedTokens }
        : { status: 'unavailable' },
      ...(finalizerTelemetry ? { llmCalls: Math.max(1, finalizerTelemetry.attempt) } : {}),
      toolCalls: runtime.toolCalls,
      searchRequests: runtime.searchRequests,
      crawlRequests: runtime.crawlRequests,
    },
  };
  const validation = validateRenderableNews({
    ...normalizedCandidate,
    metadata: {
      ...metadata,
      ...(finalizerTelemetry ? { researchFinalizer: finalizerTelemetry } : {}),
      researchReceipt: receipt,
    },
  });
  if (!validation.ok) {
    return { errors: [...policyErrors, ...validation.errors], policyViolation: policyErrors.length > 0 };
  }
  const groundingErrors = evidenceGroundingErrors(rawReceipt, evidencePacket);
  return {
    ...(policyErrors.length || groundingErrors.length ? {} : { artifact: validation.data }),
    errors: [...policyErrors, ...groundingErrors],
    // A model-authored grounding mismatch is repairable from the frozen packet;
    // budget overruns are runtime policy violations and must fail closed.
    policyViolation: policyErrors.length > 0,
  };
}

export function materializeStructuredResearchFinalization(input: {
  runId: string;
  phaseAThreadId: string;
  seed: ResearchSeed;
  evidencePacket: string;
  decision: ResearchTriageDecision;
  runtime: ResearchRuntimeReceipt;
  finalization: StructuredResearchFinalization;
}): { artifact?: RenderableDataItem; errors: string[]; policyViolation: boolean } {
  if (input.decision.policyVersion === RESEARCH_TRIAGE_POLICY_VERSION && parseEvidenceLedger(input.evidencePacket)?.entries.length) {
    return materializeServerOwnedEditorialArtifact(input);
  }
  return materializeArtifact(
    input.finalization.candidate,
    input.seed,
    input.phaseAThreadId,
    input.runId,
    input.runtime,
    input.decision,
    input.evidencePacket,
    input.finalization.telemetry,
  );
}

export async function inspectResearchCanary(
  params: {
    runId: string;
    seed: ResearchSeed;
    jobId: string;
    threadId: string;
    phase: ResearchCanaryPhase;
    decision: ResearchTriageDecision;
    priorRuntime?: ResearchRuntimeReceipt;
    priorEvidencePacket?: string;
    extensionReceipt?: ResearchExtensionAuditReceipt;
  },
  config: ResearchCanaryConfig = getResearchCanaryConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<ResearchCanaryInspection> {
  const [jobResult, threadResult] = await Promise.all([
    tryGetJob(params.jobId, config, fetchImpl),
    tryGetThread(params.threadId, config, fetchImpl),
  ]);
  const turns = relevantTurns(threadResult.snapshot, params.runId);
  const phaseRuntime = summarizeRuntime(turns);
  const runtime = addRuntime(params.priorRuntime, phaseRuntime);
  const errors = [jobResult.error, threadResult.error].filter((item): item is string => Boolean(item));
  const base = { runtime, phaseRuntime, jobMissing: jobResult.missing };

  if (hasPendingInteraction(turns)) {
    return {
      ...base,
      status: 'needs_input',
      jobStatus: jobResult.snapshot?.status,
      errors: [...errors, 'Straylight thread 正在等待结构化 interaction；canary 不自动代答'],
      retryable: false,
    };
  }

  const latestAgent = latestAgentTurn(turns);
  const latestError = agentErrorText(latestAgent);
  const jobStatus = cleanString(jobResult.snapshot?.status);

  if (params.phase === 'research') {
    const budget = params.decision.budget;
    if (!budget) {
      return {
        ...base,
        status: 'invalid',
        jobStatus,
        errors: [...errors, 'Research decision 缺少 budget'],
        retryable: false,
      };
    }
    if (phaseRuntime.toolCalls > budget.maxToolCalls) {
      return {
        ...base,
        status: 'invalid',
        jobStatus,
        evidencePacket: buildResearchEvidencePacket(turns, budget.maxEvidenceChars, params.seed),
        errors: [...errors, `Research tool budget 超限: ${phaseRuntime.toolCalls} > ${budget.maxToolCalls}`],
        retryable: false,
      };
    }
    if ((jobStatus === 'pending' || jobStatus === 'running') && !['completed', 'error'].includes(cleanString(latestAgent?.state))) {
      return { ...base, status: 'running', jobStatus, errors, retryable: false };
    }

    const successfulTools = phaseRuntime.toolCalls - phaseRuntime.failedToolCalls;
    if (successfulTools > 0 && (jobStatus === 'completed' || jobStatus === 'error' || jobResult.missing || ['completed', 'error'].includes(cleanString(latestAgent?.state)))) {
      const evidencePacket = buildResearchEvidencePacket(turns, budget.maxEvidenceChars, params.seed);
      const extensionErrors = researchExtensionOutcomeErrors(turns, params.runId, params.seed, params.extensionReceipt);
      if (extensionErrors.length > 0) {
        return {
          ...base,
          status: 'invalid',
          jobStatus,
          evidencePacket,
          errors: [...errors, ...extensionErrors],
          retryable: false,
        };
      }
      const coverageErrors = researchMinimumCoverageErrors(phaseRuntime, params.decision);
      if (params.decision.policyVersion === RESEARCH_TRIAGE_POLICY_VERSION && params.decision.researchMode === 'digest') {
        const ledger = parseEvidenceLedger(evidencePacket);
        if (!ledger?.entries.length) {
          coverageErrors.push('digest minimum coverage 未满足: 至少需要 1 个 support-eligible crawl');
        }
        if ((ledger?.toolSummary.successfulSearchRequests ?? 0) < 1
          && !coverageErrors.some((error) => error.includes('成功的 freshness/provenance targeted search'))) {
          coverageErrors.push('digest minimum coverage 未满足: 至少需要 1 次成功的 freshness/provenance targeted search');
        }
      }
      const initialToolCalls = budget.initialToolCalls ?? 0;
      const stagedRepairAvailable = params.decision.researchMode === 'digest'
        && (budget.extensionToolCalls ?? 0) > 0
        && initialToolCalls > 0
        && phaseRuntime.toolCalls >= initialToolCalls
        && phaseRuntime.toolCalls < budget.maxToolCalls;
      if (coverageErrors.length > 0 && !stagedRepairAvailable) {
        return {
          ...base,
          status: 'invalid',
          jobStatus,
          evidencePacket,
          errors: [...errors, ...coverageErrors],
          retryable: false,
        };
      }
      const completionErrors = [
        ...errors,
        ...(coverageErrors.length > 0 ? coverageErrors : []),
        ...(latestError ? [`Phase A agent 尾部错误已降级为 evidence-only: ${latestError}`] : []),
      ];
      return {
        ...base,
        status: 'research_complete',
        jobStatus,
        evidencePacket,
        errors: completionErrors,
        retryable: false,
      };
    }
    if (latestError || jobStatus === 'error') {
      return {
        ...base,
        status: 'failed',
        jobStatus,
        errors: [...errors, latestError || cleanString(jobResult.snapshot?.error) || 'Straylight research phase error'],
        retryable: false,
      };
    }
    if (jobResult.missing) {
      return {
        ...base,
        status: 'failed',
        errors: [...errors, 'Straylight research job 已丢失，thread 中没有可恢复的成功 tool evidence'],
        retryable: false,
      };
    }
    return {
      ...base,
      status: jobStatus === 'completed' ? 'invalid' : 'running',
      jobStatus,
      errors: jobStatus === 'completed' ? [...errors, 'Research phase 完成但没有成功 tool evidence'] : errors,
      retryable: false,
    };
  }

  // Phase B is a pure synthesis call. One tool call is already a policy violation.
  if (phaseRuntime.toolCalls > 0) {
    return {
      ...base,
      status: 'invalid',
      jobStatus,
      errors: [...errors, `Finalization phase 违反 no-tools 契约: ${phaseRuntime.toolCalls} tool calls`],
      retryable: false,
    };
  }
  if (latestError) {
    return {
      ...base,
      status: 'failed',
      jobStatus,
      errors: [...errors, latestError],
      // A fresh-thread Phase-B retry is allowed once for runtime/no-event failures.
      // It still remains no-tools and uses the same frozen evidence packet.
      retryable: true,
    };
  }

  const responseText = cleanString(jobResult.snapshot?.response) || latestCompletedAgentText(turns);
  if (!responseText && (jobStatus === 'pending' || jobStatus === 'running')) {
    return { ...base, status: 'running', jobStatus, errors, retryable: false };
  }
  if (!responseText && jobStatus === 'error') {
    return {
      ...base,
      status: 'failed',
      jobStatus,
      errors: [...errors, cleanString(jobResult.snapshot?.error) || 'Straylight finalization job error'],
      retryable: false,
    };
  }
  if (!responseText && jobResult.missing) {
    return {
      ...base,
      status: 'failed',
      errors: [...errors, 'Straylight finalization job 已丢失，持久 thread 中也没有可恢复的最终文本'],
      retryable: false,
    };
  }
  if (!responseText) {
    return {
      ...base,
      status: 'invalid',
      jobStatus,
      errors: [...errors, 'Finalization phase 没有最终 JSON 文本'],
      retryable: true,
    };
  }

  let candidate: Record<string, unknown>;
  try {
    candidate = parseStrictJsonObject(responseText);
  } catch (error) {
    return {
      ...base,
      status: 'invalid',
      jobStatus,
      errors: [...errors, error instanceof Error ? error.message : String(error)],
      retryable: true,
    };
  }

  const materialized = materializeArtifact(
    candidate,
    params.seed,
    params.threadId,
    params.jobId,
    runtime,
    params.decision,
    params.priorEvidencePacket,
  );
  if (!materialized.artifact) {
    return {
      ...base,
      status: 'invalid',
      jobStatus,
      errors: [...errors, ...materialized.errors],
      retryable: !materialized.policyViolation,
    };
  }

  return {
    ...base,
    status: 'completed',
    jobStatus,
    artifact: materialized.artifact,
    errors,
    retryable: false,
  };
}
