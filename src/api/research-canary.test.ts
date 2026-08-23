import { describe, expect, it } from 'bun:test';
import {
  buildResearchEvidencePacket,
  dispatchResearchCanary,
  dispatchResearchFinalization,
  inspectResearchCanary,
  RESEARCH_EVIDENCE_PACKET_VERSION,
  researchCanaryIdentity,
  type ResearchCanaryConfig,
  type ResearchRuntimeReceipt,
} from './research-canary.js';
import { triageResearchCandidate } from './research-triage.js';

const config: ResearchCanaryConfig = {
  enabled: true,
  baseUrl: 'https://straylight.example/api',
  agentId: 'pi-mono',
  requestTimeoutMs: 5_000,
};
const finalizerConfig: ResearchCanaryConfig = {
  ...config,
  finalizerProviderId: 'hy3',
};

const seed = {
  title: 'MCP 新规范取消会话',
  content: '点击查看原文>',
  source: 'InfoQ',
  link: 'https://www.infoq.cn/example',
  category: 'technology',
};
const seedDecision = triageResearchCandidate({ seed });

const phaseARuntime: ResearchRuntimeReceipt = {
  toolCalls: 2,
  searchRequests: 0,
  crawlRequests: 2,
  failedToolCalls: 0,
};

function validCandidate() {
  return {
    id: 'quote0-neuromancer-run-1',
    title: 'MCP新规范取消会话',
    message: 'MCP新规范取消协议会话和初始化握手；请求加入Mcp-Method与Mcp-Name标头，网关可直接据此路由和限流。',
    signature: '神经漫游者',
    source: 'MCP官方·InfoQ',
    publishTime: '2026-08-17T00:00:00.000Z',
    category: 'news',
    link: 'https://modelcontextprotocol.io/example',
    highlights: ['Mcp-Method', 'Mcp-Name'],
    metadata: {
      researchReceipt: {
        schemaVersion: 'neuromancer-research/v1',
        agent: 'neuromancer',
        sources: [
          { id: 'seed', url: 'https://www.infoq.cn/example', role: 'seed' },
          { id: 'official', url: 'https://modelcontextprotocol.io/example', role: 'official' },
          { id: 'primary', url: 'https://example.com/primary', role: 'primary' },
        ],
        claims: [
          { text: 'MCP取消协议会话和初始化握手', sourceIds: ['official'], status: 'supported' },
          { text: '请求加入Mcp-Method与Mcp-Name标头', sourceIds: ['official'], status: 'supported' },
        ],
        retrieval: { status: 'degraded', enginesUsed: ['scrapling', 'bing'] },
        usage: { toolCalls: 999, providerReportedTokens: { status: 'reported', total: 999999 } },
      },
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function phaseATurns(tools: Array<Record<string, unknown>>) {
  return [
    { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
    { participantType: 'agent', state: 'completed', blocks: [], toolCalls: tools },
  ];
}

function phaseBTurns(text: string, toolCalls: Array<Record<string, unknown>> = []) {
  return [
    { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
    { participantType: 'agent', state: 'completed', blocks: [{ type: 'text', text }], toolCalls },
  ];
}

describe('research canary adapter', () => {
  it('dispatches seed-only Phase A as a deeper recovery run to pi-mono', async () => {
    let captured: any;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ jobId: 'job-a', threadId: 'thread-a' }, 202);
    }) as typeof fetch;

    const dispatched = await dispatchResearchCanary('run-1', seed, seedDecision, config, fetchImpl);

    expect(dispatched).toEqual({ jobId: 'job-a', threadId: 'thread-a' });
    expect(captured.agentId).toBe('pi-mono');
    expect(captured.source).toEqual({ channel: 'agent', identity: researchCanaryIdentity('run-1') });
    expect(captured.message).toContain('Phase A：只负责检索和事实核验');
    expect(captured.message).toContain('研究模式：recovery');
    expect(captured.message).toContain('最多 10 次工具调用');
    expect(captured.message).toContain('Marginal-gain stop');
  });

  it('treats completed+empty with successful tool evidence as research_complete, not invalid', async () => {
    const tools = [
      { name: 'crawl', status: 'completed', input: { url: seed.link }, output: { content: 'InfoQ seed evidence' } },
      { name: 'crawl', status: 'completed', input: { url: 'https://modelcontextprotocol.io/spec' }, output: { content: 'Official MCP evidence' } },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-a')) return jsonResponse({ jobId: 'job-a', threadId: 'thread-a', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-a')) return jsonResponse({ turns: phaseATurns(tools) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-a', threadId: 'thread-a', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('research_complete');
    expect(result.runtime).toEqual(phaseARuntime);
    expect(result.phaseRuntime).toEqual(phaseARuntime);
    expect(result.evidencePacket).toContain(`version=${RESEARCH_EVIDENCE_PACKET_VERSION}`);
    expect(result.evidencePacket).toContain('Official MCP evidence');
  });

  it('fails closed when universal digest finishes without the required targeted search', async () => {
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
      source: 'Example',
      link: 'https://example.com/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    const tools = [
      { name: 'crawl', status: 'completed', input: { url: digestSeed.link }, output: { content: 'Canonical product update' } },
      { name: 'crawl', status: 'completed', input: { url: 'https://example.com/docs' }, output: { content: 'Related first-party docs' } },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-digest')) return jsonResponse({ jobId: 'job-digest', threadId: 'thread-digest', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-digest')) return jsonResponse({ turns: phaseATurns(tools) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed: digestSeed, decision: digestDecision, jobId: 'job-digest', threadId: 'thread-digest', phase: 'research',
    }, config, fetchImpl);

    expect(digestDecision.researchMode).toBe('digest');
    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('至少需要 1 次 freshness/provenance targeted search');
  });

  it('allows universal digest to advance once targeted search evidence is present', async () => {
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
      source: 'Example',
      link: 'https://example.com/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    const tools = [
      { name: 'crawl', status: 'completed', input: { url: digestSeed.link }, output: { content: 'Canonical product update' } },
      { name: 'search', status: 'completed', input: { q: 'product update freshness provenance' }, output: { results: [] } },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-digest')) return jsonResponse({ jobId: 'job-digest', threadId: 'thread-digest', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-digest')) return jsonResponse({ turns: phaseATurns(tools) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed: digestSeed, decision: digestDecision, jobId: 'job-digest', threadId: 'thread-digest', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('research_complete');
    expect(result.runtime.searchRequests).toBe(1);
  });

  it('unwraps duplicate Straylight envelopes and supports a decision-sized evidence packet', () => {
    const huge = 'x'.repeat(10_000);
    const crawlEnvelope = JSON.stringify({
      status: 'completed',
      url: 'https://example.com/a',
      engine: 'scrapling',
      result: { title: 'Primary article', formatted: huge, text: huge, url: 'https://example.com/a' },
    });
    const searchEnvelope = JSON.stringify({
      query: 'MCP stateless',
      results: [
        { title: 'Primary', url: 'https://example.com/primary', content: 'primary result '.repeat(100), engine: 'bing', score: 0.9 },
      ],
      actual_engines: ['bing'],
      engine_status: 'healthy',
    });
    const turns = phaseATurns([
      { name: 'crawl', status: 'completed', input: { url: 'https://example.com/a' }, output: { content: [{ type: 'text', text: crawlEnvelope }], details: {} } },
      { name: 'search', status: 'completed', input: { q: 'MCP stateless' }, output: { content: [{ type: 'text', text: searchEnvelope }], details: {} } },
    ]);

    const defaultPacket = buildResearchEvidencePacket(turns as any);
    const deepPacket = buildResearchEvidencePacket(turns as any, 8_000);

    expect(defaultPacket.length).toBeLessThanOrEqual(6_000);
    expect(deepPacket.length).toBeLessThanOrEqual(8_000);
    expect(deepPacket.length).toBeGreaterThanOrEqual(defaultPacket.length);
    expect(defaultPacket).toContain('[TRUNCATED');
    expect(defaultPacket).toContain('"body"');
    expect(defaultPacket).not.toContain('"formatted"');
    expect(defaultPacket).not.toContain('"text"');
    expect(defaultPacket).toContain('tool=search');
  });

  it('dispatches Phase B on a fresh thread with the frozen packet and v3 decision', async () => {
    let captured: any;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ jobId: 'job-b', threadId: 'thread-b' }, 202);
    }) as typeof fetch;

    const dispatched = await dispatchResearchFinalization(
      'run-1',
      seed,
      'version=quote0-evidence-packet/v1\n[EVIDENCE 1] output=official',
      seedDecision,
      { directDraft: { title: 'Direct draft', message: 'Direct detail' } },
      finalizerConfig,
      fetchImpl,
    );

    expect(dispatched).toEqual({ jobId: 'job-b', threadId: 'thread-b' });
    expect(captured.threadId).toBeUndefined();
    expect(captured.providerId).toBe('hy3');
    expect(captured.message).toContain('Phase B finalizer');
    expect(captured.message).toContain('researchMode=recovery');
    expect(captured.message).toContain('绝对禁止调用任何工具');
    expect(captured.message).toContain('Direct Draft');
    expect(captured.message).toContain('Direct detail');
    expect(captured.message).toContain('output=official');
  });

  it('derives cumulative usage from Phase-A runtime while Phase B remains zero-tool', async () => {
    const candidate = validCandidate();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      if (url.endsWith('/threads/thread-b')) return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(result.status).toBe('completed');
    expect(result.phaseRuntime.toolCalls).toBe(0);
    expect(result.runtime).toEqual(phaseARuntime);
    expect(result.artifact?.metadata?.researchReceipt?.usage?.toolCalls).toBe(2);
    expect(result.artifact?.metadata?.researchReceipt?.usage?.providerReportedTokens).toEqual({ status: 'unavailable' });
    expect(result.artifact?.metadata?.researchReceipt?.seed?.content).toBe('点击查看原文>');
    expect(result.artifact?.message).toBe(candidate.message);
  });

  it('preserves the full rich seed in domain input while capping Receipt seed.content at 1000 chars', async () => {
    const candidate = validCandidate();
    const richSeed = { ...seed, content: '事实段一。事实段二；事实段三。'.repeat(500) };
    const richDecision = triageResearchCandidate({ seed: richSeed, manual: true });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      if (url.endsWith('/threads/thread-b')) return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed: richSeed, decision: richDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(richSeed.content.length).toBeGreaterThan(1_000);
    expect(result.status).toBe('completed');
    expect(result.artifact?.metadata?.researchReceipt?.seed?.content).toHaveLength(1_000);
  });

  it('recovers Phase B output from persistent thread text when ephemeral /jobs state is gone', async () => {
    const candidate = validCandidate();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-lost')) return jsonResponse({ error: 'job not found' }, 404);
      if (url.endsWith('/threads/thread-b')) return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-lost', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(result.status).toBe('completed');
    expect(result.jobMissing).toBe(true);
    expect(result.artifact?.title).toBe(candidate.title);
  });

  it('reports waiting_user truthfully instead of completed+empty', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-a')) return jsonResponse({ jobId: 'job-a', threadId: 'thread-a', status: 'completed', response: '' });
      return jsonResponse({
        turns: [
          { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
          { participantType: 'agent', state: 'waiting_user', blocks: [{ type: 'interaction', interactionStatus: 'pending' }], toolCalls: [] },
        ],
      });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-a', threadId: 'thread-a', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('needs_input');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('不自动代答');
  });

  it('fails closed when Phase A exceeds the dynamic ten-tool recovery budget', async () => {
    const tools = Array.from({ length: 11 }, (_, index) => ({
      name: index === 0 ? 'search' : 'crawl', status: 'completed', output: { index },
    }));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-a')) return jsonResponse({ jobId: 'job-a', threadId: 'thread-a', status: 'completed', response: '' });
      return jsonResponse({ turns: phaseATurns(tools) });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-a', threadId: 'thread-a', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('11 > 10');
  });

  it('fails closed when a recovery artifact exceeds its five-source/five-claim cap', async () => {
    const candidate = validCandidate() as any;
    candidate.metadata.researchReceipt.sources.push(
      { id: 'extra1', url: 'https://example.com/extra1', role: 'secondary' },
      { id: 'extra2', url: 'https://example.com/extra2', role: 'secondary' },
      { id: 'extra3', url: 'https://example.com/extra3', role: 'secondary' },
    );
    candidate.metadata.researchReceipt.claims.push(
      { text: 'claim-3', sourceIds: ['official'], status: 'supported' },
      { text: 'claim-4', sourceIds: ['official'], status: 'supported' },
      { text: 'claim-5', sourceIds: ['official'], status: 'supported' },
      { text: 'claim-6', sourceIds: ['official'], status: 'supported' },
    );
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('source artifact budget 超限');
    expect(result.errors.join(' ')).toContain('claim budget 超限');
  });

  it('fails closed if Phase B calls even one tool', async () => {
    const candidate = validCandidate();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate), [{ name: 'search', status: 'completed' }]) });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('no-tools');
  });

  it('classifies an agent error turn as failed instead of parsing its synthetic text as JSON', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: '' });
      return jsonResponse({
        turns: [
          { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
          {
            participantType: 'agent', state: 'error', toolCalls: [],
            blocks: [{ type: 'text', text: '（Agent 出错：pi-json produced no assistant or tool events after one recovery attempt）' }],
          },
        ],
      });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.errors.join(' ')).toContain('pi-json produced no assistant');
  });
});
