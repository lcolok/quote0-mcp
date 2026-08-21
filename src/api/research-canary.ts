import { createHash } from 'node:crypto';
import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import {
  NEUROMANCER_RESEARCH_RECEIPT_VERSION,
  normalizeNeuromancerFinalArtifact,
  validateRenderableNews,
  type NeuromancerResearchReceipt,
} from './renderable-news-intake.js';
import {
  buildNeuromancerEvidenceFinalizationPrompt,
  buildNeuromancerResearchPrompt,
  type NeuromancerEditorialDraft,
} from './research-few-shot.js';
import type { ResearchSeed, ResearchTriageDecision } from './research-triage.js';

export const RESEARCH_CANARY_MODE = 'straylight-jobs-canary/v1';
export const RESEARCH_CANARY_SOURCE_PREFIX = 'quote0-research-canary';
export const RESEARCH_EVIDENCE_PACKET_VERSION = 'quote0-evidence-packet/v1';

export type ResearchCanaryPhase = 'research' | 'finalization';

export interface ResearchCanaryConfig {
  enabled: boolean;
  baseUrl?: string;
  agentId: string;
  researchProviderId?: string;
  finalizerProviderId?: string;
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

export function getResearchCanaryConfig(env: NodeJS.ProcessEnv = process.env): ResearchCanaryConfig {
  const enabled = String(env.QUOTE0_RESEARCH_CANARY_ENABLED || '').toLowerCase() === 'true';
  const baseUrlRaw = cleanString(env.STRAYLIGHT_RESEARCH_BASE_URL);
  const timeoutRaw = Number.parseInt(env.STRAYLIGHT_RESEARCH_REQUEST_TIMEOUT_MS || '15000', 10);
  return {
    enabled,
    ...(baseUrlRaw ? { baseUrl: normalizeBaseUrl(baseUrlRaw) } : {}),
    agentId: cleanString(env.STRAYLIGHT_RESEARCH_AGENT_ID) || 'pi-mono',
    ...(cleanString(env.STRAYLIGHT_RESEARCH_PROVIDER_ID)
      ? { researchProviderId: cleanString(env.STRAYLIGHT_RESEARCH_PROVIDER_ID) }
      : {}),
    ...(cleanString(env.STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID)
      ? { finalizerProviderId: cleanString(env.STRAYLIGHT_RESEARCH_FINALIZER_PROVIDER_ID) }
      : {}),
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
    body: JSON.stringify({
      message: buildNeuromancerResearchPrompt(seed, decision, runId),
      agentId: config.agentId,
      ...(config.researchProviderId ? { providerId: config.researchProviderId } : {}),
      source: { channel: 'agent', identity: researchCanaryIdentity(runId) },
    }),
  }, fetchImpl);

  if (!isPlainObject(payload)) throw new Error('Straylight /jobs 返回格式无效');
  const jobId = cleanString(payload.jobId);
  const threadId = cleanString(payload.threadId);
  if (!jobId || !threadId) throw new Error('Straylight /jobs 缺少 jobId/threadId');
  return { jobId, threadId };
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
      ...(config.finalizerProviderId ? { providerId: config.finalizerProviderId } : {}),
      source: { channel: 'agent', identity: researchCanaryIdentity(runId) },
    }),
  }, fetchImpl);

  if (!isPlainObject(payload)) throw new Error('Straylight finalization /jobs 返回格式无效');
  const jobId = cleanString(payload.jobId);
  const threadId = cleanString(payload.threadId);
  if (!jobId || !threadId) throw new Error('Straylight finalization /jobs 缺少 jobId/threadId');
  return { jobId, threadId };
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
export function buildResearchEvidencePacket(turns: StraylightThreadTurn[], maxPacketChars = 6_000): string {
  const MAX_PACKET_CHARS = Math.max(2_000, Math.min(12_000, Math.round(maxPacketChars)));
  const calls = turns
    .filter((turn) => turn.participantType === 'agent')
    .flatMap((turn) => Array.isArray(turn.toolCalls) ? turn.toolCalls! : []);

  const chunks: string[] = [`version=${RESEARCH_EVIDENCE_PACKET_VERSION}`];
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
  };
}

function materializeArtifact(
  candidate: Record<string, unknown>,
  seed: ResearchSeed,
  threadId: string,
  jobId: string,
  runtime: ResearchRuntimeReceipt,
  decision: ResearchTriageDecision,
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

  const receipt = {
    ...rawReceipt,
    schemaVersion: NEUROMANCER_RESEARCH_RECEIPT_VERSION,
    agent: 'neuromancer',
    threadId,
    runId: jobId,
    generatedAt: new Date().toISOString(),
    seed: seedReceipt(seed),
    // Accounting evidence is runtime-derived. Any model-authored usage is discarded.
    usage: {
      providerReportedTokens: { status: 'unavailable' },
      toolCalls: runtime.toolCalls,
      searchRequests: runtime.searchRequests,
      crawlRequests: runtime.crawlRequests,
    },
  };
  const validation = validateRenderableNews({
    ...normalizedCandidate,
    metadata: { ...metadata, researchReceipt: receipt },
  });
  if (!validation.ok) {
    return { errors: [...policyErrors, ...validation.errors], policyViolation: policyErrors.length > 0 };
  }
  return {
    ...(policyErrors.length ? {} : { artifact: validation.data }),
    errors: policyErrors,
    policyViolation: policyErrors.length > 0,
  };
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
        evidencePacket: buildResearchEvidencePacket(turns, budget.maxEvidenceChars),
        errors: [...errors, `Research tool budget 超限: ${phaseRuntime.toolCalls} > ${budget.maxToolCalls}`],
        retryable: false,
      };
    }
    if ((jobStatus === 'pending' || jobStatus === 'running') && !['completed', 'error'].includes(cleanString(latestAgent?.state))) {
      return { ...base, status: 'running', jobStatus, errors, retryable: false };
    }

    const successfulTools = phaseRuntime.toolCalls - phaseRuntime.failedToolCalls;
    if (successfulTools > 0 && (jobStatus === 'completed' || jobStatus === 'error' || jobResult.missing || ['completed', 'error'].includes(cleanString(latestAgent?.state)))) {
      return {
        ...base,
        status: 'research_complete',
        jobStatus,
        evidencePacket: buildResearchEvidencePacket(turns, budget.maxEvidenceChars),
        errors: latestError ? [...errors, `Phase A agent 尾部错误已降级为 evidence-only: ${latestError}`] : errors,
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

  const materialized = materializeArtifact(candidate, params.seed, params.threadId, params.jobId, runtime, params.decision);
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
