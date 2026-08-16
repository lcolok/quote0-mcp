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

const seed = {
  title: 'MCP 新规范取消会话',
  content: '点击查看原文>',
  source: 'InfoQ',
  link: 'https://www.infoq.cn/example',
  category: 'technology',
};

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

describe('research canary adapter', () => {
  it('dispatches Phase A as bounded retrieval-only work to pi-mono', async () => {
    let captured: any;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ jobId: 'job-a', threadId: 'thread-a' }, 202);
    }) as typeof fetch;
    const decision = triageResearchCandidate({ seed });

    const dispatched = await dispatchResearchCanary('run-1', seed, decision, config, fetchImpl);

    expect(dispatched).toEqual({ jobId: 'job-a', threadId: 'thread-a' });
    expect(captured.agentId).toBe('pi-mono');
    expect(captured.source).toEqual({ channel: 'agent', identity: researchCanaryIdentity('run-1') });
    expect(captured.message).toContain('Phase A：只负责检索和事实核验');
    expect(captured.message).toContain('最多 6 次工具调用');
  });

  it('treats completed+empty with successful tool evidence as research_complete, not invalid', async () => {
    const tools = [
      { name: 'crawl', status: 'completed', input: { url: seed.link }, output: { content: 'InfoQ seed evidence' } },
      { name: 'crawl', status: 'completed', input: { url: 'https://modelcontextprotocol.io/spec' }, output: { content: 'Official MCP evidence' } },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-a')) {
        return jsonResponse({ jobId: 'job-a', threadId: 'thread-a', status: 'completed', response: '' });
      }
      if (url.endsWith('/threads/thread-a')) return jsonResponse({ turns: phaseATurns(tools) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, jobId: 'job-a', threadId: 'thread-a', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('research_complete');
    expect(result.runtime).toEqual(phaseARuntime);
    expect(result.phaseRuntime).toEqual(phaseARuntime);
    expect(result.evidencePacket).toContain(`version=${RESEARCH_EVIDENCE_PACKET_VERSION}`);
    expect(result.evidencePacket).toContain('Official MCP evidence');
  });

  it('unwraps duplicate Straylight envelopes and caps the deterministic evidence packet at 6k', () => {
    const huge = 'x'.repeat(8_000);
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

    const first = buildResearchEvidencePacket(turns as any);
    const second = buildResearchEvidencePacket(turns as any);

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(6_000);
    expect(first).toContain('[TRUNCATED');
    expect(first).toContain('"body"');
    expect(first).not.toContain('"formatted"');
    expect(first).not.toContain('"text"');
    expect(first).toContain('tool=search');
  });

  it('dispatches Phase B on a fresh thread with the frozen packet and no threadId reuse', async () => {
    let captured: any;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ jobId: 'job-b', threadId: 'thread-b' }, 202);
    }) as typeof fetch;

    const dispatched = await dispatchResearchFinalization(
      'run-1', seed, 'version=quote0-evidence-packet/v1\n[EVIDENCE 1] output=official', [], config, fetchImpl,
    );

    expect(dispatched).toEqual({ jobId: 'job-b', threadId: 'thread-b' });
    expect(captured.threadId).toBeUndefined();
    expect(captured.message).toContain('Phase B finalizer');
    expect(captured.message).toContain('绝对禁止调用任何工具');
    expect(captured.message).toContain('output=official');
  });

  it('derives cumulative usage from Phase-A runtime while Phase B remains zero-tool', async () => {
    const candidate = validCandidate();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) {
        return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      }
      if (url.endsWith('/threads/thread-b')) {
        return jsonResponse({
          turns: [
            { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
            { participantType: 'agent', state: 'completed', blocks: [{ type: 'text', text: JSON.stringify(candidate) }], toolCalls: [] },
          ],
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
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
    const richSeed = { ...seed, content: 'x'.repeat(6_341) };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) {
        return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      }
      if (url.endsWith('/threads/thread-b')) {
        return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed: richSeed, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(richSeed.content).toHaveLength(6_341);
    expect(result.status).toBe('completed');
    expect(result.artifact?.metadata?.researchReceipt?.seed?.content).toHaveLength(1_000);
  });

  it('recovers Phase B output from persistent thread text when ephemeral /jobs state is gone', async () => {
    const candidate = validCandidate();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-lost')) return jsonResponse({ error: 'job not found' }, 404);
      if (url.endsWith('/threads/thread-b')) {
        return jsonResponse({
          turns: [
            { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
            { participantType: 'agent', state: 'completed', blocks: [{ type: 'text', text: JSON.stringify(candidate) }], toolCalls: [] },
          ],
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, jobId: 'job-lost', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
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
      runId: 'run-1', seed, jobId: 'job-a', threadId: 'thread-a', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('needs_input');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('不自动代答');
  });

  it('fails closed when Phase A exceeds the six-tool budget', async () => {
    const tools = Array.from({ length: 7 }, (_, index) => ({
      name: index === 0 ? 'search' : 'crawl', status: 'completed', output: { index },
    }));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-a')) return jsonResponse({ jobId: 'job-a', threadId: 'thread-a', status: 'completed', response: '' });
      return jsonResponse({ turns: phaseATurns(tools) });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, jobId: 'job-a', threadId: 'thread-a', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('tool budget 超限');
  });

  it('fails closed when the v2 final artifact exceeds 3 sources or 4 claims', async () => {
    const candidate = validCandidate() as any;
    candidate.metadata.researchReceipt.sources.push({
      id: 'extra', url: 'https://example.com/extra', role: 'secondary',
    });
    candidate.metadata.researchReceipt.claims.push(
      { text: 'claim-3', sourceIds: ['official'], status: 'supported' },
      { text: 'claim-4', sourceIds: ['official'], status: 'supported' },
      { text: 'claim-5', sourceIds: ['official'], status: 'supported' },
    );
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization',
      priorRuntime: { toolCalls: 2, crawlRequests: 2, searchRequests: 0, failedToolCalls: 0 },
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
      return jsonResponse({
        turns: [
          { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
          { participantType: 'agent', state: 'completed', blocks: [{ type: 'text', text: JSON.stringify(candidate) }], toolCalls: [{ name: 'search', status: 'completed' }] },
        ],
      });
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
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
      runId: 'run-1', seed, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime,
    }, config, fetchImpl);

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.errors.join(' ')).toContain('pi-json produced no assistant');
  });
});
