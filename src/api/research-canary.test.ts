import { describe, expect, it } from 'bun:test';
import {
  buildResearchEvidencePacket,
  dispatchResearchCanary,
  dispatchResearchExtension,
  dispatchResearchFinalization,
  dispatchStructuredResearchFinalization,
  getResearchCanaryConfig,
  inspectResearchCanary,
  materializeStructuredResearchFinalization,
  RESEARCH_EVIDENCE_PACKET_VERSION,
  researchCanaryIdentity,
  shouldExtendDigestResearch,
  type ResearchCanaryConfig,
  type ResearchRuntimeReceipt,
} from './research-canary.js';
import { triageResearchCandidate } from './research-triage.js';

const config: ResearchCanaryConfig = {
  enabled: true,
  baseUrl: 'https://straylight.example/api',
  agentId: 'pi-mono',
  researchProviderId: 'local-qwen',
  finalizerProviderId: 'local-qwen',
  structuredFinalizer: false,
  requestTimeoutMs: 5_000,
};
const finalizerConfig: ResearchCanaryConfig = { ...config };

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

function validGroundingPacket() {
  return buildResearchEvidencePacket(phaseATurns([
    {
      name: 'crawl',
      status: 'completed',
      input: { url: 'https://modelcontextprotocol.io/example' },
      output: {
        status: 'completed',
        url: 'https://modelcontextprotocol.io/example',
        result: { url: 'https://modelcontextprotocol.io/example', text: 'Official MCP evidence' },
      },
    },
    {
      name: 'crawl',
      status: 'completed',
      input: { url: 'https://www.infoq.cn/example' },
      output: {
        status: 'completed',
        url: 'https://www.infoq.cn/example',
        result: { url: 'https://www.infoq.cn/example', text: 'Seed evidence' },
      },
    },
  ]), 6_000, seed);
}

function validEditorialDecision() {
  return {
    titleCandidates: ['MCP新规范取消会话', 'MCP取消会话握手', 'MCP新增网关路由标头'],
    facts: [
      { text: 'MCP新规范取消协议会话和初始化握手', evidenceIds: ['E1'] },
      { text: '请求新增Mcp-Method与Mcp-Name标头，网关可据此路由和限流', evidenceIds: ['E1'] },
    ],
    publishTime: '2026-08-17T00:00:00.000Z',
    linkEvidenceId: 'E1',
  };
}

describe('research canary adapter', () => {
  it('fails closed when Quote0 Research is configured to a non-Qwen provider', () => {
    expect(() => getResearchCanaryConfig({
      QUOTE0_RESEARCH_CANARY_ENABLED: 'true',
      STRAYLIGHT_RESEARCH_PROVIDER_ID: 'kimi-for-coding',
    } as NodeJS.ProcessEnv)).toThrow('仅允许 local-qwen');
  });

  it('dispatches seed-only Phase A as a deeper recovery run to pi-mono', async () => {
    let captured: any;
    let capturedHeaders: Headers | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ jobId: 'job-a', threadId: 'thread-a' }, 202);
    }) as typeof fetch;

    const dispatched = await dispatchResearchCanary('run-1', seed, seedDecision, config, fetchImpl);

    expect(dispatched).toEqual({ jobId: 'job-a', threadId: 'thread-a' });
    expect(captured.agentId).toBe('pi-mono');
    expect(captured.providerId).toBe('local-qwen');
    expect(capturedHeaders?.get('x-straylight-provider-fallback')).toBe('off');
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('10');
    expect(captured.source).toEqual({ channel: 'agent', identity: researchCanaryIdentity('run-1') });
    expect(captured.message).toContain('Phase A：只负责检索和事实核验');
    expect(captured.message).toContain('研究模式：recovery');
    expect(captured.message).toContain('最多 10 次工具调用');
    expect(captured.message).toContain('Marginal-gain stop');
  });

  it('uses a hard 3 + conditional 1 staged budget for universal digest research', async () => {
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。'.repeat(4),
      source: 'Vendor Blog',
      link: 'https://seed.example/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    let capturedHeaders: Headers | undefined;
    let captured: any;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ jobId: 'job-digest', threadId: captured?.threadId || 'thread-digest' }, 202);
    }) as typeof fetch;

    await dispatchResearchCanary('run-digest', digestSeed, digestDecision, config, fetchImpl);
    expect(digestDecision.budget).toEqual(expect.objectContaining({ maxToolCalls: 4, initialToolCalls: 3, extensionToolCalls: 1 }));
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('3');
    expect(captured.message).toContain('staged budget');
    expect(captured.message).toContain('本段硬上限 3 次');

    const initialTools = [
      {
        name: 'crawl', status: 'completed', input: { url: digestSeed.link },
        output: { status: 'completed', url: digestSeed.link, engine: 'scrapling', result: { title: 'Seed', url: digestSeed.link, text: 'seed body' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'product update official independent' },
        output: { query: 'product update official independent', results: [{ title: 'Independent', url: 'https://independent.example/report', content: 'corroboration', engine: 'anysearch' }] },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${digestSeed.link}?utm_source=dup` },
        output: { status: 'completed', url: `${digestSeed.link}?utm_source=dup`, engine: 'scrapling', result: { title: 'Seed duplicate', url: `${digestSeed.link}?utm_source=dup`, text: 'same body' } },
      },
    ];
    const initialPacket = buildResearchEvidencePacket(phaseATurns(initialTools), 5_000, digestSeed);
    const initialRuntime: ResearchRuntimeReceipt = { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 };
    const extensionDecision = shouldExtendDigestResearch(initialPacket, initialRuntime, digestDecision);
    expect(extensionDecision).toEqual(expect.objectContaining({ extend: true, reason: 'novel-evidence-candidate' }));
    expect(extensionDecision.candidateUrls).toContain('https://independent.example/report');

    capturedHeaders = undefined;
    captured = undefined;
    const extended = await dispatchResearchExtension(
      'run-digest', 'thread-digest', digestSeed, initialPacket, digestDecision, config, fetchImpl,
    );
    expect(extended).toEqual({ jobId: 'job-digest', threadId: 'thread-digest' });
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('1');
    expect(captured.threadId).toBe('thread-digest');
    expect(captured.message).toContain('只额外授权 1 次工具调用');

    const enoughPacket = buildResearchEvidencePacket(phaseATurns([
      initialTools[0],
      initialTools[1],
      {
        name: 'crawl', status: 'completed', input: { url: 'https://independent.example/report' },
        output: { status: 'completed', url: 'https://independent.example/report', engine: 'scrapling', result: { title: 'Independent', url: 'https://independent.example/report', text: 'independent body' } },
      },
    ]), 5_000, digestSeed);
    expect(shouldExtendDigestResearch(enoughPacket, initialRuntime, digestDecision)).toEqual(expect.objectContaining({
      extend: false,
      reason: 'coverage-sufficient',
    }));
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

  it('dispatches Phase B on a fresh thread with the frozen packet and current decision', async () => {
    let captured: any;
    let capturedHeaders: Headers | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      capturedHeaders = new Headers(init?.headers);
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
    expect(captured.providerId).toBe('local-qwen');
    expect(capturedHeaders?.get('x-straylight-provider-fallback')).toBe('off');
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('0');
    expect(captured.message).toContain('Phase B finalizer');
    expect(captured.message).toContain('researchMode=recovery');
    expect(captured.message).toContain('绝对禁止调用任何工具');
    expect(captured.message).toContain('Direct Draft');
    expect(captured.message).toContain('Direct detail');
    expect(captured.message).toContain('output=official');
  });

  it('uses Straylight structured inference for a no-session Qwen finalizer', async () => {
    let capturedUrl = '';
    let captured: any;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      return jsonResponse({
        providerId: 'local-qwen',
        model: 'qwen3.8-27b',
        parsed: validEditorialDecision(),
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          total_tokens: 168,
          prompt_tokens_details: { cached_tokens: 7 },
        },
        finishReason: 'stop',
        latencyMs: 1234,
      });
    }) as typeof fetch;

    const result = await dispatchStructuredResearchFinalization(
      'run-1',
      seed,
      validGroundingPacket(),
      seedDecision,
      { directDraft: { title: 'Direct', message: 'Direct detail' }, attempt: 2 },
      { ...config, structuredFinalizer: true },
      fetchImpl,
    );

    expect(capturedUrl).toEndWith('/inference/structured');
    expect(captured.providerId).toBe('local-qwen');
    expect(captured.messages).toHaveLength(1);
    expect(captured.jsonSchema.name).toBe('quote0_server_owned_editorial');
    expect(captured.jsonSchema.schema.properties.facts.items.properties.evidenceIds.items.enum).toEqual(['E1', 'E2']);
    expect(captured.jsonSchema.schema.properties.metadata).toBeUndefined();
    expect(captured.messages[0].content).toContain('Quote0 服务器会自行生成 researchReceipt');
    expect(captured.agentId).toBeUndefined();
    expect(result.candidate.titleCandidates).toEqual(validEditorialDecision().titleCandidates);
    expect(result.telemetry).toEqual({
      mode: 'structured-inference',
      providerId: 'local-qwen',
      model: 'qwen3.8-27b',
      latencyMs: 1234,
      finishReason: 'stop',
      attempt: 2,
      usage: { input: 123, output: 45, cacheRead: 7, total: 168 },
    });
  });

  it('server-owns receipt/source/highlights and assembles only complete grounded fact sentences', () => {
    const decision = validEditorialDecision() as any;
    const result = materializeStructuredResearchFinalization({
      runId: 'run-1',
      phaseAThreadId: 'phase-a-thread',
      seed,
      evidencePacket: validGroundingPacket(),
      decision: seedDecision,
      runtime: phaseARuntime,
      finalization: {
        candidate: {
          ...decision,
          source: '模型伪造来源',
          highlights: ['模型伪造高亮'],
          metadata: { researchReceipt: { sources: [{ url: 'https://evil.example' }] } },
        },
        telemetry: {
          mode: 'structured-inference',
          providerId: 'local-qwen',
          model: 'qwen3.8-27b',
          latencyMs: 1200,
          attempt: 1,
          usage: { input: 100, output: 40, total: 140, cacheRead: 5 },
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.policyViolation).toBe(false);
    expect(result.artifact?.title).toBe('MCP新规范取消会话');
    expect(result.artifact?.message).toBe('MCP新规范取消协议会话和初始化握手；请求新增Mcp-Method与Mcp-Name标头，网关可据此路由和限流。');
    expect(result.artifact?.source).toBe('modelcontextprotocol.io');
    expect(result.artifact?.highlights).toBeUndefined();
    expect(result.artifact?.metadata?.researchArtifactOwnership).toBe('quote0-server/v1');
    expect(result.artifact?.metadata?.researchReceipt?.threadId).toBe('phase-a-thread');
    expect(result.artifact?.metadata?.researchReceipt?.sources).toEqual([
      expect.objectContaining({ id: 'E1', url: 'https://modelcontextprotocol.io/example', role: 'secondary' }),
    ]);
    expect(result.artifact?.metadata?.researchReceipt?.claims).toEqual([
      { text: 'MCP新规范取消协议会话和初始化握手', sourceIds: ['E1'], status: 'supported' },
      { text: '请求新增Mcp-Method与Mcp-Name标头，网关可据此路由和限流', sourceIds: ['E1'], status: 'supported' },
    ]);
    expect(result.artifact?.metadata?.researchReceipt?.usage?.providerReportedTokens).toEqual({
      status: 'reported', input: 100, output: 40, total: 140, cacheRead: 5,
    });
  });

  it('skips an over-capacity fact as a whole instead of truncating a sentence', () => {
    const result = materializeStructuredResearchFinalization({
      runId: 'run-overflow',
      phaseAThreadId: 'phase-a-thread',
      seed,
      evidencePacket: validGroundingPacket(),
      decision: seedDecision,
      runtime: phaseARuntime,
      finalization: {
        candidate: {
          titleCandidates: ['MCP会话机制变化', 'MCP新规范', 'MCP协议更新'],
          facts: [
            { text: '这是一条故意制造的超长事实句'.repeat(40), evidenceIds: ['E1'] },
            { text: 'MCP新规范取消协议会话和初始化握手', evidenceIds: ['E1'] },
          ],
          publishTime: '2026-08-17T00:00:00.000Z',
          linkEvidenceId: 'E1',
        },
        telemetry: {
          mode: 'structured-inference', providerId: 'local-qwen', model: 'qwen3.8-27b', latencyMs: 900, attempt: 1,
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.artifact?.message).toBe('MCP新规范取消协议会话和初始化握手。');
    expect(result.artifact?.message).not.toContain('故意制造的超长');
    expect(result.artifact?.metadata?.researchReceipt?.claims).toEqual([
      { text: 'MCP新规范取消协议会话和初始化握手', sourceIds: ['E1'], status: 'supported' },
    ]);
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
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime, priorEvidencePacket: validGroundingPacket(),
    }, config, fetchImpl);

    expect(result.status).toBe('completed');
    expect(result.phaseRuntime.toolCalls).toBe(0);
    expect(result.runtime).toEqual(phaseARuntime);
    expect(result.artifact?.metadata?.researchReceipt?.usage?.toolCalls).toBe(2);
    expect(result.artifact?.metadata?.researchReceipt?.usage?.providerReportedTokens).toEqual({ status: 'unavailable' });
    expect(result.artifact?.metadata?.researchReceipt?.seed?.content).toBe('点击查看原文>');
    expect(result.artifact?.message).toBe(candidate.message);
  });

  it('rejects supported claims that cite search-only URLs without a successful crawl', async () => {
    const candidate = validCandidate();
    const searchOnlyPacket = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'search',
        status: 'completed',
        input: { q: 'MCP official spec' },
        output: {
          query: 'MCP official spec',
          results: [{ title: 'MCP official', url: 'https://modelcontextprotocol.io/example', content: 'search snippet only' }],
        },
      },
    ]));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-b')) return jsonResponse({ jobId: 'job-b', threadId: 'thread-b', status: 'completed', response: JSON.stringify(candidate) });
      if (url.endsWith('/threads/thread-b')) return jsonResponse({ turns: phaseBTurns(JSON.stringify(candidate)) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1',
      seed,
      decision: seedDecision,
      jobId: 'job-b',
      threadId: 'thread-b',
      phase: 'finalization',
      priorRuntime: { toolCalls: 1, searchRequests: 1, crawlRequests: 0, failedToolCalls: 0 },
      priorEvidencePacket: searchOnlyPacket,
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(true);
    expect(result.errors.join(' ')).toContain('未经过成功 crawl/snapshot');
    expect(result.errors.join(' ')).toContain('search snippet 只能作为线索');
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
      runId: 'run-1', seed: richSeed, decision: richDecision, jobId: 'job-b', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime, priorEvidencePacket: validGroundingPacket(),
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
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-lost', threadId: 'thread-b', phase: 'finalization', priorRuntime: phaseARuntime, priorEvidencePacket: validGroundingPacket(),
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
