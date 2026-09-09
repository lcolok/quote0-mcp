/**
 * Phase B terminal-tool HTTP 端点验收（mock PG，无需真实数据库）。
 *
 * 只覆盖 /api/news/research/terminal/finish 的鉴权 / fail-closed / rejected / accepted 契约。
 * 线程 inspection 三种形状与 schema 拒绝、mode 路由、retry 带 errors 在 research-canary.test.ts
 * 用纯逻辑验收；这里只验真正的 HTTP 端点行为。
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildResearchEvidencePacket, getResearchCanaryConfig, RESEARCH_EVIDENCE_LEDGER_VERSION, researchCanaryIdentity } from './research-canary.js';
import { RESEARCH_TRIAGE_POLICY_VERSION, triageResearchCandidate } from './research-triage.js';

// --- mock PG（bun 的 mock.module 进程全局生效，本文件用 cache-bust import 拿到 stub） ---
let runRow: Record<string, unknown>;
/** Last triage JSON written by the manual canary INSERT (index 10 of the params array). */
let lastInsertedTriage: Record<string, unknown> | undefined;
const postgresStub: any = {
  initialize: async () => undefined,
  query: async (sql: string, params?: unknown[]) => {
    const statement = String(sql);
    if (statement.includes('INSERT INTO research_runs')) {
      const raw = Array.isArray(params) ? params[10] : undefined;
      try {
        lastInsertedTriage = typeof raw === 'string' ? JSON.parse(raw) : undefined;
      } catch {
        lastInsertedTriage = undefined;
      }
      // Manual canary mints a fresh candidate id; the stub returns a single row regardless so the
      // store's INSERT ... RETURNING * line resolves.
      return { rows: [runRow] };
    }
    if (statement.startsWith('UPDATE research_runs')) {
      // Mirror the store's UPDATE ... RETURNING * against the shared runRow so reconcile tests can
      // observe state/evidence transitions in the response payload.
      applyResearchRunUpdate(statement, params);
      return { rows: [runRow] };
    }
    // getResearchRun 以第一个参数为 runId。
    const requestedId = Array.isArray(params) ? String(params[0]) : '';
    if (requestedId && requestedId !== 'run-terminal') return { rows: [] };
    return { rows: [runRow] };
  },
};

/** Apply the column changes of a research_runs UPDATE to the shared runRow stub. */
function applyResearchRunUpdate(statement: string, params?: unknown[]) {
  const list = Array.isArray(params) ? params : [];
  const row = runRow as Record<string, unknown>;
  if (statement.includes('attempts=attempts+1')) {
    // markResearchRunDispatched / markResearchRunResearchExtended: [id, jobId, [jobId], threadId, ...]
    row.attempts = Number(row.attempts || 0) + 1;
    row.state = 'running';
    row.straylight_job_id = String(list[1] ?? '');
    row.straylight_thread_id = String(list[3] ?? '');
    return;
  }
  if (statement.includes('terminal_receipt=$2')) {
    // markResearchRunTerminalReceipt: [id, receipt]
    row.terminal_receipt = typeof list[1] === 'string' ? JSON.parse(list[1]) : list[1];
    return;
  }
  if (statement.includes('research_extension_receipt=$5')) {
    // markResearchRunResearchExtended: [id, jobId, [jobId], threadId, receipt]
    row.state = 'running';
    row.straylight_job_id = String(list[1] ?? '');
    row.straylight_thread_id = String(list[3] ?? '');
    row.research_extension_receipt = typeof list[4] === 'string' ? JSON.parse(list[4]) : list[4];
    return;
  }
  // markResearchRunState: [id, state, runtime, artifact, validationErrors, evidence, error, terminal]
  row.state = String(list[1] ?? row.state);
  if (typeof list[2] === 'string' && list[2]) row.runtime_receipt = JSON.parse(list[2]);
  if (typeof list[4] === 'string' && list[4]) row.validation_errors = JSON.parse(list[4]);
  if (typeof list[5] === 'string' && list[5]) row.evidence_snapshot = list[5];
  if (typeof list[6] === 'string' && list[6]) row.error = list[6];
  if (list[7] === true && !row.completed_at) row.completed_at = new Date().toISOString();
}

mock.module('../react-widgets/core/postgres-database.js', () => ({
  getPostgresDatabase: () => postgresStub,
}));

// cache-bust 动态导入，确保在 mock.module 生效后才加载 research-canary-api（同仓既有模式）。
const { default: researchCanaryApp } = await import(`./research-canary-api.js?terminal=t${Date.now()}`);

const seed = {
  title: 'MCP 新规范取消会话',
  content: '点击查看原文>',
  sourceId: 'infoq-cn',
  source: 'InfoQ',
  link: 'https://www.infoq.cn/example',
  category: 'technology',
  publishTime: '2026-08-17T00:00:00.000Z',
};

function phaseATurns(tools: Array<Record<string, unknown>>) {
  return [
    { participantType: 'user', source: { identity: researchCanaryIdentity('run-terminal') }, blocks: [] },
    { participantType: 'agent', state: 'completed', blocks: [], toolCalls: tools },
  ];
}

function validGroundingPacket() {
  return buildResearchEvidencePacket(phaseATurns([
    {
      name: 'crawl', status: 'completed', input: { url: 'https://modelcontextprotocol.io/example' },
      output: { status: 'completed', url: 'https://modelcontextprotocol.io/example', result: { url: 'https://modelcontextprotocol.io/example', text: 'Official MCP evidence' } },
    },
    {
      name: 'crawl', status: 'completed', input: { url: seed.link },
      output: { status: 'completed', url: seed.link, result: { url: seed.link, text: 'Seed evidence' } },
    },
  ]), 6_000, seed);
}

function validCandidate() {
  return {
    titleCandidates: ['MCP新规范取消会话', 'MCP取消会话握手', 'MCP新增网关路由标头'],
    facts: [
      { text: 'MCP新规范取消协议会话和初始化握手', evidenceIds: ['E1'] },
      { text: '请求新增Mcp-Method与Mcp-Name标头，网关可据此路由和限流', evidenceIds: ['E1'] },
    ],
    linkEvidenceId: 'E1',
  };
}

const decision = triageResearchCandidate({ seed });
const triage = { ...decision, phaseBMode: 'terminal-tool' };

function makeRunRow() {
  const now = new Date().toISOString();
  return {
    id: 'run-terminal',
    mode: 'straylight-jobs-canary/v1',
    fingerprint: 'fp',
    idempotency_key: 'k',
    state: 'running',
    policy_version: decision.policyVersion,
    agent_id: 'pi-mono',
    trigger: 'manual',
    source_inventory_id: null,
    straylight_job_id: 'job-t1',
    straylight_job_ids: ['job-a', 'job-t1'],
    straylight_thread_id: 'thread-a',
    straylight_thread_ids: ['thread-a'],
    evidence_snapshot: validGroundingPacket(),
    direct_snapshot: null,
    attempts: 2,
    result_artifact: null,
    runtime_receipt: { toolCalls: 2, searchRequests: 0, crawlRequests: 2, failedToolCalls: 0 },
    validation_errors: [],
    error: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    input_snapshot: seed,
    triage,
    research_extension_receipt: null,
    terminal_receipt: null,
  };
}

const post = (body: unknown, token?: string) =>
  researchCanaryApp.request('/api/news/research/terminal/finish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const manualPost = (body: unknown) =>
  researchCanaryApp.request('/api/news/research/canary/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// --- empty-ledger fixtures for the terminal-tool fail-fast guard ---

// Non-staged (verification) decision: phase A can reach research_complete on a packet whose
// ledger has zero support-eligible entries, mirroring the production sparse-evidence runs.
const reconcileDecision = triageResearchCandidate({ seed, manual: true, conflict: true });

function emptyLedgerPhaseATurns() {
  return phaseATurns([
    {
      name: 'crawl', status: 'completed', input: { url: seed.link },
      output: { status: 'completed', url: seed.link, engine: 'scrapling', result: { title: '403 Forbidden', url: seed.link, text: '403 Forbidden' } },
    },
    {
      name: 'search', status: 'completed', input: { q: 'MCP session cancellation provenance' },
      output: { query: 'MCP session cancellation provenance', results: [] },
    },
  ]);
}

function emptyLedgerPacket() {
  const packet = buildResearchEvidencePacket(emptyLedgerPhaseATurns() as never, 6_000, seed);
  const ledgerLine = packet.split('\n').find((line) => line.startsWith('ledger='));
  const ledger = JSON.parse(String(ledgerLine).slice('ledger='.length)) as { entries: unknown[] };
  expect(ledger.entries).toEqual([]);
  return packet;
}

function jsonOk(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchCall = { method: string; url: string };

/** Stub Straylight for the reconcile handler (job/thread inspection + optional dispatches). */
function replayStraylight(calls: FetchCall[], turns: unknown[], options: { structured?: unknown } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    calls.push({ method, url });
    if (method === 'GET' && url.endsWith('/jobs/job-t1')) {
      return jsonOk({ jobId: 'job-t1', threadId: 'thread-a', status: 'completed', response: '' });
    }
    if (method === 'GET' && url.endsWith('/threads/thread-a')) {
      return jsonOk({ turns });
    }
    if (method === 'POST' && url.endsWith('/inference/structured')) {
      if (options.structured === undefined) return jsonOk({ error: 'unexpected structured call' }, 500);
      return jsonOk(options.structured);
    }
    if (method === 'POST' && url.endsWith('/jobs')) {
      return jsonOk({ jobId: 'job-t2', threadId: 'thread-a' }, 202);
    }
    return jsonOk({ error: 'not found' }, 404);
  }) as typeof fetch;
}

const reconcilePost = () =>
  researchCanaryApp.request('/api/news/research/canary/jobs/run-terminal/reconcile', { method: 'POST' });

describe('POST /api/news/research/terminal/finish', () => {
  beforeEach(() => {
    runRow = makeRunRow();
    lastInsertedTriage = undefined;
    delete process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN;
  });

  it('fails closed with 503 when the terminal token is not configured', async () => {
    const res = await post(validCandidate());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.trusted).toBe(false);
    expect(body.errors.join(' ')).toContain('QUOTE0_RESEARCH_TERMINAL_TOKEN');
  });

  it('rejects a missing or wrong bearer token with 401', async () => {
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'real-secret';
    const res = await post(validCandidate(), 'wrong-secret');
    expect(res.status).toBe(401);
    expect((await res.json()).errors.join(' ')).toContain('Unauthorized');
  });

  it('rejects a runId that does not exist with a 200 + outcome=rejected', async () => {
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'real-secret';
    const res = await post({ ...validCandidate(), runId: 'no-such-run' }, 'real-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trusted).toBe(true);
    expect(body.outcome).toBe('rejected');
    expect(body.errors.join(' ')).toContain('research_run 不存在');
  });

  it('rejects a candidate the structured schema does not allow (extra field) with 200 + rejected', async () => {
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'real-secret';
    const res = await post({ ...validCandidate(), runId: 'run-terminal', source: '模型伪造来源' }, 'real-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe('rejected');
    expect(body.errors.join(' ')).toContain('不允许的字段 source');
  });

  it('rejects with the empty-ledger gate error (200 + rejected) instead of falling back to the legacy schema', async () => {
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'real-secret';
    runRow.evidence_snapshot = emptyLedgerPacket();
    const res = await post({ ...validCandidate(), runId: 'run-terminal' }, 'real-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trusted).toBe(true);
    expect(body.outcome).toBe('rejected');
    expect(body.artifact).toBeNull();
    expect(body.errors[0]).toContain(`缺少 ${RESEARCH_EVIDENCE_LEDGER_VERSION} 可支持证据`);
    // The legacy full-artifact schema fallback must not leak its misleading missing-field errors.
    expect(body.errors.join(' ')).not.toContain('缺少必填字段');
    expect(runRow.terminal_receipt).toMatchObject({ outcome: 'rejected' });
  });

  it('accepts a candidate that passes every publish gate and returns the trusted artifact', async () => {
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'real-secret';
    const res = await post({ ...validCandidate(), runId: 'run-terminal' }, 'real-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trusted).toBe(true);
    expect(body.outcome).toBe('accepted');
    expect(body.errors).toEqual([]);
    expect(body.summary).toBe(body.artifact?.title);
    expect(body.artifact?.title).toBe('MCP新规范取消会话');
    expect(body.artifact?.message).toContain('取消协议会话和初始化握手');
    expect(body.deeplink).toContain('/annotate?view=neuromancer');
    // No inventory writes from the endpoint — terminal_receipt is the only durable trace.
    expect(body).not.toHaveProperty('resultArtifact');
  });
});

describe('Patch A: manual canary phaseBMode override', () => {
  beforeEach(() => {
    runRow = makeRunRow();
    lastInsertedTriage = undefined;
    process.env.QUOTE0_RESEARCH_CANARY_ENABLED = 'true';
    process.env.STRAYLIGHT_RESEARCH_BASE_URL = 'https://straylight.example/api';
  });

  it('freezes an explicit terminal-tool override into run.triage.phaseBMode', async () => {
    const res = await manualPost({ seed, phaseBMode: 'terminal-tool' });
    expect(res.status).toBe(200);
    expect(lastInsertedTriage?.phaseBMode).toBe('terminal-tool');
  });

  it('freezes an explicit structured-inference override into run.triage.phaseBMode', async () => {
    const res = await manualPost({ seed, phaseBMode: 'structured-inference' });
    expect(res.status).toBe(200);
    expect(lastInsertedTriage?.phaseBMode).toBe('structured-inference');
  });

  it('rejects an invalid phaseBMode value with 400', async () => {
    const res = await manualPost({ seed, phaseBMode: 'agent-job' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('structured-inference');
  });

  it('falls back to the env default when phaseBMode is omitted', async () => {
    process.env.QUOTE0_RESEARCH_PHASE_B_MODE = 'terminal-tool';
    const res = await manualPost({ seed });
    expect(res.status).toBe(200);
    expect(lastInsertedTriage?.phaseBMode).toBe('terminal-tool');
  });
});

describe('Patch 1c: manual canary universal passthrough', () => {
  beforeEach(() => {
    runRow = makeRunRow();
    lastInsertedTriage = undefined;
    process.env.QUOTE0_RESEARCH_CANARY_ENABLED = 'true';
    process.env.STRAYLIGHT_RESEARCH_BASE_URL = 'https://straylight.example/api';
  });

  it('pushes universal=true into the frozen run triage with the universal evidence reason', async () => {
    const res = await manualPost({ seed, universal: true });
    expect(res.status).toBe(200);
    expect(lastInsertedTriage?.reasons).toContain('universal-evidence');
  });

  it('keeps default (universal omitted) behaviour identical to today', async () => {
    const res = await manualPost({ seed });
    expect(res.status).toBe(200);
    expect(lastInsertedTriage?.reasons).not.toContain('universal-evidence');
  });
});

describe('Patch B: terminal token file source', () => {
  const tokenDir = join(tmpdir(), 'quote0-terminal-test');
  const tokenFile = join(tokenDir, 'quote0-research-terminal.token');

  beforeEach(() => {
    runRow = makeRunRow();
    delete process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN;
    delete process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN_FILE;
  });

  it('reports "missing" when neither token nor file is configured', () => {
    const config = getResearchCanaryConfig({
      QUOTE0_RESEARCH_PHASE_B_MODE: 'terminal-tool',
    } as NodeJS.ProcessEnv);
    expect(config.terminalTokenSource).toBe('missing');
    expect(config.terminalToken).toBeUndefined();
  });

  it('prefers the file token over the env token and trims it', () => {
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(tokenFile, '  file-secret\n');
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'env-secret';
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN_FILE = tokenFile;
    const config = getResearchCanaryConfig({
      QUOTE0_RESEARCH_TERMINAL_TOKEN: 'env-secret',
      QUOTE0_RESEARCH_TERMINAL_TOKEN_FILE: tokenFile,
    } as NodeJS.ProcessEnv);
    expect(config.terminalTokenSource).toBe('file');
    expect(config.terminalToken).toBe('file-secret');
  });

  it('falls back to env when the file is absent or empty', () => {
    rmSync(tokenDir, { recursive: true, force: true });
    process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN = 'env-secret';
    const config = getResearchCanaryConfig({
      QUOTE0_RESEARCH_TERMINAL_TOKEN: 'env-secret',
      QUOTE0_RESEARCH_TERMINAL_TOKEN_FILE: tokenFile,
    } as NodeJS.ProcessEnv);
    expect(config.terminalTokenSource).toBe('env');
    expect(config.terminalToken).toBe('env-secret');
  });
});

describe('POST /api/news/research/canary/jobs/:id/reconcile — empty evidence ledger fail-fast', () => {
  beforeEach(() => {
    runRow = makeRunRow();
    delete process.env.QUOTE0_RESEARCH_TERMINAL_TOKEN;
    delete process.env.QUOTE0_RESEARCH_PHASE_B_MODE;
    delete process.env.QUOTE0_RESEARCH_STRUCTURED_FINALIZER;
    process.env.QUOTE0_RESEARCH_CANARY_ENABLED = 'true';
    process.env.STRAYLIGHT_RESEARCH_BASE_URL = 'https://straylight.example/api';
  });

  it('marks a terminal-tool run invalid without dispatching when Phase A froze an empty evidence ledger', async () => {
    runRow.state = 'running';
    runRow.attempts = 1;
    runRow.triage = { ...reconcileDecision, phaseBMode: 'terminal-tool' };
    const calls: FetchCall[] = [];
    replayStraylight(calls, emptyLedgerPhaseATurns());

    const res = await reconcilePost();
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.reconciled).toBe(true);
    expect(body.data.state).toBe('invalid');
    expect(body.data.validationErrors[0]).toContain(`缺少 ${RESEARCH_EVIDENCE_LEDGER_VERSION} 可支持证据`);
    // The terminal-tool continuation must never be dispatched: no POST /jobs at all.
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/jobs'))).toHaveLength(0);
  });

  it('keeps structured-inference behavior unchanged on the same empty packet (no guard interception)', async () => {
    runRow.state = 'running';
    runRow.attempts = 1;
    runRow.triage = { ...reconcileDecision, phaseBMode: 'structured-inference' };
    const calls: FetchCall[] = [];
    replayStraylight(calls, emptyLedgerPhaseATurns());

    const res = await reconcilePost();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.reconciled).toBe(true);
    expect(body.structuredFinalizer).toBe(true);
    // Unchanged legacy-structured flow: the empty packet still dispatches its own finalizer
    // attempts and fails closed there — it is never short-circuited by the terminal-tool gate.
    expect(body.data.state).toBe('failed');
    expect(body.error).toContain('Structured Phase B');
    expect(body.error).not.toContain('可支持证据');
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/inference/structured')).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/jobs'))).toHaveLength(0);
  });
});