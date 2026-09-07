import { describe, expect, it } from 'bun:test';
import {
  buildNeuromancerTerminalFinalizationPrompt,
} from './research-few-shot.js';
import {
  buildResearchEvidencePacket,
  dispatchResearchCanary,
  dispatchResearchExtension,
  dispatchResearchFinalization,
  dispatchResearchTerminalFinalization,
  dispatchStructuredResearchFinalization,
  getResearchCanaryConfig,
  inspectResearchCanary,
  materializeStructuredResearchFinalization,
  RESEARCH_EVIDENCE_PACKET_VERSION,
  researchCanaryIdentity,
  researchExtensionOutcomeErrors,
  shouldExtendDigestResearch,
  minimumEditorialFactCount,
  structuredFinalizationSchema,
  validateResearchCandidateShape,
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
  phaseBMode: 'agent-job',
  requestTimeoutMs: 5_000,
};
const finalizerConfig: ResearchCanaryConfig = { ...config };

const seed = {
  title: 'MCP 新规范取消会话',
  content: '点击查看原文>',
  sourceId: 'infoq-cn',
  source: 'InfoQ',
  link: 'https://www.infoq.cn/example',
  category: 'technology',
  publishTime: '2026-08-17T00:00:00.000Z',
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
    expect(captured.message).toContain('整个 Research 的绝对总上限仍为 15 次');
    expect(captured.message).toContain('额外授权 5 次');
    expect(captured.message).toContain('Marginal-gain stop');
  });

  it('uses a 10 + conditional 5 staged recovery budget instead of mechanically spending 15 calls', async () => {
    const recoveryDecision = triageResearchCandidate({ seed });
    const packet = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: seed.link },
        output: { status: 'completed', url: seed.link, engine: 'scrapling', result: { title: seed.title, url: seed.link, text: 'InfoQ canonical body with concrete Agent engineering details and deployment context.' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'MCP stateless gateway independent verification' },
        output: { query: 'MCP stateless gateway independent verification', results: [
          { title: 'MCP 新规范取消会话：独立验证 stateless gateway', url: 'https://www.reuters.com/technology/mcp-stateless-gateway-verification/', content: 'MCP 新规范取消会话，并调整 stateless gateway 的会话与路由机制。', engine: 'bing', score: 0.7 },
        ] },
      },
    ]), 10_000, seed);
    const runtime: ResearchRuntimeReceipt = { toolCalls: 10, searchRequests: 5, crawlRequests: 5, failedToolCalls: 0 };
    const extension = shouldExtendDigestResearch(packet, runtime, recoveryDecision);
    expect(extension).toEqual(expect.objectContaining({
      extend: true,
      required: false,
      reason: 'novel-evidence-candidate',
      candidateUrls: ['https://www.reuters.com/technology/mcp-stateless-gateway-verification'],
    }));

    let capturedHeaders: Headers | undefined;
    let captured: any;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ jobId: 'job-recovery-extension', threadId: 'thread-recovery' }, 202);
    }) as typeof fetch;
    await dispatchResearchExtension(
      'run-recovery', 'thread-recovery', seed, packet, recoveryDecision,
      { reason: extension.reason, authorizedCandidateUrls: extension.candidateUrls }, config, fetchImpl,
    );
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('5');
    expect(captured.message).toContain('最多再调用 5 次工具');
    expect(captured.message).toContain('本段**只允许 crawl**');
    expect(captured.message).toContain('Quote0 明确授权的候选 URL（白名单）');
    expect(captured.message).toContain('https://www.reuters.com/technology/mcp-stateless-gateway-verification');
    expect(captured.message).toContain('禁止自行替换 URL');
    expect(captured.message).toContain('不机械耗尽 5 次');
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
        output: { query: 'product update official independent', results: [{ title: '普通产品更新独立验证', url: 'https://independent.example/report', content: '产品新增离线模式并改善启动速度的独立报道', engine: 'anysearch', score: 0.8 }] },
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
      'run-digest', 'thread-digest', digestSeed, initialPacket, digestDecision,
      { reason: extensionDecision.reason, authorizedCandidateUrls: extensionDecision.candidateUrls }, config, fetchImpl,
    );
    expect(extended).toEqual({ jobId: 'job-digest', threadId: 'thread-digest' });
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('1');
    expect(captured.threadId).toBe('thread-digest');
    expect(captured.message).toContain('只额外授权 1 次工具调用');
    expect(captured.message).toContain('禁止新的 search');
    expect(captured.message).toContain('https://independent.example/report');

    const enoughPacket = buildResearchEvidencePacket(phaseATurns([
      initialTools[0],
      initialTools[1],
      {
        name: 'crawl', status: 'completed', input: { url: 'https://independent.example/report' },
        output: { status: 'completed', url: 'https://independent.example/report', engine: 'scrapling', result: { title: '普通产品更新独立验证', url: 'https://independent.example/report', text: 'independent body' } },
      },
    ]), 5_000, digestSeed);
    expect(shouldExtendDigestResearch(enoughPacket, initialRuntime, digestDecision)).toEqual(expect.objectContaining({
      extend: false,
      reason: 'coverage-sufficient',
    }));
  });

  it('reserves most of a crowded digest packet for real tool evidence instead of Ledger discovery metadata', () => {
    const icelandSeed = {
      title: 'Iceland rejects reopening talks on EU entry',
      content: 'Article URL: https://www.ft.com/content/iceland-eu Comments URL: https://news.ycombinator.com/item?id=1 Points: 35 # Comments: 34',
      source: 'Hacker News: Front Page',
      link: 'https://www.ft.com/content/iceland-eu',
      category: 'news',
    };
    const searchResults = Array.from({ length: 12 }, (_, index) => ({
      title: `Iceland rejects reopening talks on EU entry independent report ${index}`,
      url: `https://independent-${index}.example.com/world/iceland-eu-accession-referendum-${index}`,
      content: 'Independent coverage of the Iceland EU accession referendum result, turnout and political background. '.repeat(4),
      engine: 'anysearch',
      score: 0.95 - index * 0.01,
    }));
    const ruvBody = `${'RÚV referendum background and coalition context. '.repeat(7)}The No side received 52.8% and the result halted plans to reopen EU accession negotiations.`;
    const packet = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: icelandSeed.link },
        output: { status: 'completed', url: icelandSeed.link, engine: 'stealth', result: { title: icelandSeed.title, url: icelandSeed.link, text: 'Financial Times canonical article about the referendum and EU accession talks. '.repeat(12) } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'Iceland EU referendum result reopening accession talks' },
        output: { query: 'Iceland EU referendum result reopening accession talks', results: searchResults },
      },
      {
        name: 'search', status: 'completed', input: { q: 'Iceland EU accession referendum turnout result RUV' },
        output: { query: 'Iceland EU accession referendum turnout result RUV', results: searchResults.slice().reverse() },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://www.ruv.is/english/iceland-rejects-eu-accession-talks' },
        output: { status: 'completed', url: 'https://www.ruv.is/english/iceland-rejects-eu-accession-talks', engine: 'stealth', result: { title: 'Iceland rejects EU accession talks - RÚV.is', url: 'https://www.ruv.is/english/iceland-rejects-eu-accession-talks', text: ruvBody } },
      },
    ]), 5_000, icelandSeed);

    const toolSectionStart = packet.indexOf('\n[EVIDENCE 1]');
    expect(packet.length).toBeLessThanOrEqual(5_000);
    expect(toolSectionStart).toBeGreaterThan(0);
    expect(packet.length - toolSectionStart).toBeGreaterThanOrEqual(2_500);
    expect(packet).toContain('52.8%');
  });

  it('rejects irrelevant scholarly search noise instead of spending the conditional fourth call', () => {
    const noiseSeed = {
      title: 'OpenAI research and deployment company overview',
      content: 'OpenAI describes itself as an AI research and deployment company. Its mission is to ensure artificial general intelligence benefits all of humanity.',
      source: 'manual',
      link: 'https://openai.com/about/',
      category: 'technology',
    };
    const noiseDecision = triageResearchCandidate({ seed: noiseSeed, universal: true });
    const tools = [
      {
        name: 'crawl', status: 'completed', input: { url: noiseSeed.link },
        output: { status: 'completed', url: noiseSeed.link, engine: 'camoufox', result: { title: 'About | OpenAI', url: noiseSeed.link, text: 'OpenAI is an AI research and deployment company.' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'OpenAI research deployment company mission' },
        output: {
          query: 'OpenAI research deployment company mission',
          results: [
            { title: 'Changing Data Sources in the Age of Machine Learning for Official Statistics', url: 'http://arxiv.org/abs/2306.04338v1', content: 'Official statistics and machine learning data sources.', engine: 'arxiv', score: 0.5 },
            { title: 'OpenAI o1 System Card', url: 'http://arxiv.org/abs/2412.16720v2', content: 'Safety evaluations for the OpenAI o1 model series.', engine: 'arxiv', score: 0.2 },
            { title: 'Learning Dexterous In-Hand Manipulation', url: 'http://arxiv.org/abs/1808.00177v5', content: 'Policies trained with the system used for OpenAI Five.', engine: 'arxiv', score: 1 },
          ],
        },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${noiseSeed.link}?utm_source=duplicate` },
        output: { status: 'completed', url: `${noiseSeed.link}?utm_source=duplicate`, engine: 'scrapling', result: { title: 'About | OpenAI', url: `${noiseSeed.link}?utm_source=duplicate`, text: 'same canonical page' } },
      },
    ];
    const packet = buildResearchEvidencePacket(phaseATurns(tools), 5_000, noiseSeed);
    const runtime: ResearchRuntimeReceipt = { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 };
    const extension = shouldExtendDigestResearch(packet, runtime, noiseDecision);

    expect(packet).toContain('"rejectedScholarlyNoise":3');
    expect(packet).toContain('"searchCandidates":[]');
    expect(extension).toEqual(expect.objectContaining({
      extend: false,
      required: false,
      reason: 'no-novel-search-candidate',
      candidateUrls: [],
    }));
  });

  it('requires source-quality admission for optional fourth-call corroboration', () => {
    const qualitySeed = {
      title: 'OpenAI public benefit company restructure',
      content: 'OpenAI changed its corporate structure while preserving its mission and public-benefit commitments. The organization described the transition, ownership changes, governance safeguards, and the relationship between the nonprofit foundation and the public benefit company. '.repeat(4),
      source: 'seed',
      link: 'https://openai.com/index/why-our-structure-must-evolve-to-advance-our-mission',
      category: 'technology',
    };
    const qualityDecision = triageResearchCandidate({ seed: qualitySeed, universal: true });
    const packetFor = (results: Array<Record<string, unknown>>) => buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: qualitySeed.link },
        output: { status: 'completed', url: qualitySeed.link, engine: 'camoufox', result: { title: 'OpenAI structure', url: qualitySeed.link, text: 'seed body' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'OpenAI public benefit company restructure' },
        output: { query: 'OpenAI public benefit company restructure', results },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${qualitySeed.link}?utm_source=dup` },
        output: { status: 'completed', url: `${qualitySeed.link}?utm_source=dup`, engine: 'scrapling', result: { title: 'OpenAI structure duplicate', url: `${qualitySeed.link}?utm_source=dup`, text: 'same body' } },
      },
    ]), 5_000, qualitySeed);
    const runtime: ResearchRuntimeReceipt = { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 };

    const lowQualityPacket = packetFor([
      { title: 'OpenAI public benefit company restructure - discussion', url: 'https://www.reddit.com/r/example/comments/1', content: 'Community discussion', engine: 'anysearch', score: 0.95 },
      { title: 'OpenAI public benefit company restructure - video', url: 'https://www.facebook.com/example/posts/1', content: 'Social repost', engine: 'anysearch', score: 0.9 },
      { title: 'OpenAI restructure explained', url: 'https://small-ai-blog.example/openai-restructure', content: 'A blog discussing the public benefit company restructure.', engine: 'anysearch', score: 0.95 },
    ]);
    const lowQualityLedger = JSON.parse((lowQualityPacket.split('\n').find((line) => line.startsWith('ledger=')) || 'ledger={}').slice(7));
    expect(lowQualityLedger.searchCandidates.length).toBeGreaterThan(0);
    expect(shouldExtendDigestResearch(lowQualityPacket, runtime, qualityDecision)).toEqual(expect.objectContaining({
      extend: false,
      reason: 'no-novel-search-candidate',
    }));

    const trustedPacket = packetFor([
      { title: 'OpenAI public benefit company restructure draws scrutiny', url: 'https://www.reuters.com/technology/openai-public-benefit-company-restructure/', content: 'Reuters reports on the OpenAI restructure.', engine: 'bing', score: 0.45 },
    ]);
    expect(shouldExtendDigestResearch(trustedPacket, runtime, qualityDecision)).toEqual(expect.objectContaining({
      extend: true,
      required: false,
      reason: 'novel-evidence-candidate',
      candidateUrls: ['https://www.reuters.com/technology/openai-public-benefit-company-restructure'],
    }));
  });

  it('groups branded third-party hosting with the seed party instead of counting it as independent provenance', () => {
    const partySeed = {
      title: 'OpenAI research and deployment company overview',
      content: 'OpenAI describes itself as an AI research and deployment company whose mission is to ensure artificial general intelligence benefits all of humanity. '.repeat(3),
      source: 'OpenAI',
      link: 'https://openai.com/about/',
      category: 'technology',
    };
    const partyDecision = triageResearchCandidate({ seed: partySeed, universal: true });
    const packet = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: 'https://openai.smapply.org/' },
        output: { status: 'completed', url: 'https://openai.smapply.org/', engine: 'scrapling', result: { title: 'OpenAI', url: 'https://openai.smapply.org/', text: 'OpenAI application portal' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'OpenAI mission research deployment company' },
        output: { query: 'OpenAI mission research deployment company', results: [
          { title: 'About OpenAI', url: 'https://openai.com/about/', content: 'OpenAI is an AI research and deployment company.', engine: 'bing', score: 0.9 },
          { title: 'OpenAI - Wikipedia', url: 'https://en.wikipedia.org/wiki/OpenAI', content: 'OpenAI is an American artificial intelligence organization.', engine: 'bing', score: 0.8 },
        ] },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://openai.smapply.org/?retry=1' },
        output: { status: 'completed', url: 'https://openai.smapply.org/?retry=1', engine: 'camoufox', result: { title: 'OpenAI', url: 'https://openai.smapply.org/?retry=1', text: 'OpenAI application portal' } },
      },
    ]), 5_000, partySeed);
    const runtime: ResearchRuntimeReceipt = { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 };
    const ledgerLine = packet.split('\n').find((line) => line.startsWith('ledger='));
    const ledger = JSON.parse((ledgerLine || 'ledger={}').slice(7));
    const extension = shouldExtendDigestResearch(packet, runtime, partyDecision);

    expect(ledger.entries[0].provenanceCluster).toBe('party:openai.com');
    expect(ledger.searchCandidates.find((item: any) => item.canonicalUrl === 'https://openai.com/about')?.provenanceCluster).toBe('party:openai.com');
    expect(ledger.searchCandidates.find((item: any) => item.domain === 'wikipedia.org')?.provenanceCluster).toBe('wikipedia.org');
    expect(extension).toEqual(expect.objectContaining({
      extend: true,
      required: false,
      reason: 'novel-evidence-candidate',
      existingClusters: ['party:openai.com'],
      candidateUrls: ['https://en.wikipedia.org/wiki/OpenAI'],
    }));
  });

  it('machine-enforces the conditional extension tool type and authorized URL', () => {
    const stagedTurns = (extensionTools: Array<Record<string, unknown>>) => [
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'crawl', status: 'completed', input: { url: seed.link }, output: { status: 'completed', url: seed.link } }] },
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: extensionTools },
    ];

    expect(researchExtensionOutcomeErrors(
      stagedTurns([{ name: 'crawl', status: 'completed', input: { url: seed.link }, output: { status: 'completed', url: seed.link } }]),
      'run-1',
      seed,
      { reason: 'minimum-search-repair', required: true, authorizedCandidateUrls: [], initialToolCalls: 3, extensionToolCalls: 1 },
    ).join(' ')).toContain('必须执行 search');

    expect(researchExtensionOutcomeErrors(
      stagedTurns([{ name: 'crawl', status: 'completed', input: { url: 'https://www.reddit.com/r/example/comments/1' }, output: { status: 'completed', url: 'https://www.reddit.com/r/example/comments/1' } }]),
      'run-1',
      seed,
      {
        reason: 'novel-evidence-candidate', required: false,
        authorizedCandidateUrls: ['https://www.reuters.com/technology/authorized-report'],
        initialToolCalls: 3, extensionToolCalls: 1,
      },
    ).join(' ')).toContain('越权');

    expect(researchExtensionOutcomeErrors(
      stagedTurns([{ name: 'crawl', status: 'completed', input: { url: 'https://www.reuters.com/technology/authorized-report?utm_source=search' }, output: { status: 'completed', url: 'https://www.reuters.com/technology/authorized-report' } }]),
      'run-1',
      seed,
      {
        reason: 'novel-evidence-candidate', required: false,
        authorizedCandidateUrls: ['https://www.reuters.com/technology/authorized-report'],
        initialToolCalls: 3, extensionToolCalls: 1,
      },
    )).toEqual([]);

    expect(researchExtensionOutcomeErrors(
      stagedTurns([
        { name: 'crawl', status: 'completed', input: { url: 'https://www.reuters.com/technology/authorized-report' }, output: { status: 'completed', url: 'https://www.reuters.com/technology/authorized-report' } },
        { name: 'crawl', status: 'completed', input: { url: 'https://www.bbc.com/news/authorized-second' }, output: { status: 'completed', url: 'https://www.bbc.com/news/authorized-second' } },
      ]),
      'run-1',
      seed,
      {
        reason: 'novel-evidence-candidate', required: false,
        authorizedCandidateUrls: [
          'https://www.reuters.com/technology/authorized-report',
          'https://www.bbc.com/news/authorized-second',
        ],
        initialToolCalls: 10, extensionToolCalls: 5,
      },
    )).toEqual([]);

    expect(researchExtensionOutcomeErrors(
      stagedTurns([
        { name: 'crawl', status: 'completed', input: { url: 'https://www.reuters.com/technology/authorized-report' }, output: { status: 'completed', url: 'https://www.reuters.com/technology/authorized-report' } },
        { name: 'search', status: 'completed', input: { q: 'should not search again' }, output: { results: [] } },
      ]),
      'run-1',
      seed,
      {
        reason: 'novel-evidence-candidate', required: false,
        authorizedCandidateUrls: ['https://www.reuters.com/technology/authorized-report'],
        initialToolCalls: 10, extensionToolCalls: 5,
      },
    ).join(' ')).toContain('只能执行 crawl');

    expect(researchExtensionOutcomeErrors(
      stagedTurns([{ name: 'crawl', status: 'completed', input: { url: seed.link }, output: { status: 'completed', url: seed.link } }]),
      'run-1',
      seed,
      { reason: 'minimum-evidence-repair', required: true, authorizedCandidateUrls: [], initialToolCalls: 3, extensionToolCalls: 1 },
    )).toEqual([]);
  });

  it('treats completed+empty with successful tool evidence as research_complete, not invalid', async () => {
    const tools = [
      { name: 'crawl', status: 'completed', input: { url: seed.link }, output: { content: 'InfoQ seed evidence describes the MCP session change.' } },
      { name: 'search', status: 'completed', input: { q: 'MCP session change provenance' }, output: { results: [] } },
      { name: 'crawl', status: 'completed', input: { url: 'https://modelcontextprotocol.io/spec' }, output: { content: 'Official MCP evidence confirms the protocol session and routing change.' } },
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
    expect(result.runtime).toEqual({ toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 });
    expect(result.phaseRuntime).toEqual({ toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 });
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

  it('defers a three-call digest coverage failure into one required search repair', async () => {
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。',
      source: 'Example',
      link: 'https://example.com/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    const tools = [
      {
        name: 'crawl', status: 'completed', input: { url: digestSeed.link },
        output: { status: 'completed', url: digestSeed.link, engine: 'scrapling', result: { title: 'Seed', url: digestSeed.link, text: 'Canonical product update' } },
      },
      {
        name: 'crawl', status: 'failed', isError: true, input: { url: digestSeed.link, engine: 'stealth' },
        output: { status: 'failed', url: digestSeed.link, engine: 'stealth', error: 'blocked' },
      },
      {
        name: 'crawl', status: 'failed', isError: true, input: { url: digestSeed.link, engine: 'camoufox' },
        output: { status: 'failed', url: digestSeed.link, engine: 'camoufox', error: 'blocked' },
      },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-repair')) return jsonResponse({ jobId: 'job-repair', threadId: 'thread-repair', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-repair')) return jsonResponse({ turns: phaseATurns(tools) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed: digestSeed, decision: digestDecision, jobId: 'job-repair', threadId: 'thread-repair', phase: 'research',
    }, config, fetchImpl);

    expect(result.status).toBe('research_complete');
    expect(result.runtime).toEqual({ toolCalls: 3, searchRequests: 0, crawlRequests: 3, failedToolCalls: 2 });
    expect(result.errors.join(' ')).toContain('至少需要 1 次 freshness/provenance targeted search');
    const extensionDecision = shouldExtendDigestResearch(result.evidencePacket || '', result.runtime, digestDecision);
    expect(extensionDecision).toEqual(expect.objectContaining({
      extend: true,
      required: true,
      reason: 'minimum-search-repair',
    }));

    let captured: any;
    let capturedHeaders: Headers | undefined;
    const extensionFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ jobId: 'job-repair-2', threadId: 'thread-repair' }, 202);
    }) as typeof fetch;
    await dispatchResearchExtension(
      'run-1', 'thread-repair', digestSeed, result.evidencePacket || '', digestDecision,
      { reason: extensionDecision.reason }, config, extensionFetch,
    );
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('1');
    expect(captured.message).toContain('第 1 次工具调用**必须是 targeted search**');
    expect(captured.message).toContain('若还有扩展额度，只允许 crawl 这次 search 新发现的高价值候选');
  });

  it('treats a failed search as missing minimum coverage and requires a successful repair', async () => {
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。'.repeat(4),
      source: 'Example',
      link: 'https://example.com/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    const tools = [
      {
        name: 'crawl', status: 'completed', input: { url: digestSeed.link },
        output: { status: 'completed', url: digestSeed.link, engine: 'scrapling', result: { title: 'Seed', url: digestSeed.link, text: 'Canonical update body' } },
      },
      {
        name: 'search', status: 'failed', isError: true, input: { q: 'product update provenance' },
        output: { status: 'failed', error: 'search backend unavailable' },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${digestSeed.link}?utm_source=dup` },
        output: { status: 'completed', url: `${digestSeed.link}?utm_source=dup`, engine: 'camoufox', result: { title: 'Seed duplicate', url: `${digestSeed.link}?utm_source=dup`, text: 'same body' } },
      },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-search-failed')) return jsonResponse({ jobId: 'job-search-failed', threadId: 'thread-search-failed', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-search-failed')) return jsonResponse({ turns: phaseATurns(tools) });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed: digestSeed, decision: digestDecision, jobId: 'job-search-failed', threadId: 'thread-search-failed', phase: 'research',
    }, config, fetchImpl);
    expect(result.status).toBe('research_complete');
    expect(result.runtime.searchRequests).toBe(1);
    expect(result.errors.join(' ')).toContain('至少需要 1 次成功的 freshness/provenance targeted search');
    const extension = shouldExtendDigestResearch(result.evidencePacket || '', result.runtime, digestDecision);
    expect(extension).toEqual(expect.objectContaining({
      extend: true,
      required: true,
      reason: 'minimum-search-repair',
    }));
    expect(result.evidencePacket).toContain('"successfulSearchRequests":0');
  });

  it('does not treat obvious access-denied crawl pages as support-eligible evidence', () => {
    const blockedSeed = {
      title: 'Blocked canonical page',
      content: 'A sufficiently detailed digest seed that still needs provenance confirmation. '.repeat(5),
      source: 'Example',
      link: 'https://blocked.example/article',
      category: 'technology',
    };
    const blockedDecision = triageResearchCandidate({ seed: blockedSeed, universal: true });
    const packet = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: blockedSeed.link },
        output: { status: 'completed', url: blockedSeed.link, engine: 'scrapling', result: { title: '403 Forbidden', url: blockedSeed.link, text: '403 Forbidden' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'blocked canonical provenance' },
        output: { query: 'blocked canonical provenance', results: [] },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${blockedSeed.link}?retry=1` },
        output: { status: 'completed', url: `${blockedSeed.link}?retry=1`, engine: 'camoufox', result: { title: 'Access Denied', url: `${blockedSeed.link}?retry=1`, text: 'Access Denied' } },
      },
    ]), 5_000, blockedSeed);
    const runtime: ResearchRuntimeReceipt = { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 };
    expect(packet).toContain('"entries":[]');
    expect(shouldExtendDigestResearch(packet, runtime, blockedDecision)).toEqual(expect.objectContaining({
      extend: true,
      required: true,
      reason: 'minimum-evidence-repair',
    }));
  });

  it('rejects the real 366356 empty/JavaScript shell crawl shapes while retaining substantive evidence', () => {
    const harnessSeed = {
      title: 'AI Coding 之后，如何让 Agent 进入企业研发全链路？得物推荐的 Harness 实践',
      content: '点击查看原文>',
      source: 'InfoQ',
      link: 'https://www.infoq.cn/article/sDyQxrWR6zDPJuLX4FA8',
      category: 'news',
    };
    const toutiao = 'https://www.toutiao.com/article/7657063975737164330';
    const packet = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: harnessSeed.link },
        output: { status: 'completed', url: harnessSeed.link, engine: 'scrapling', result: {
          title: harnessSeed.title,
          url: harnessSeed.link,
          body: '得物在 AICon 上海分享 AI Harness 工程实践，讨论如何把 Agent 从代码生成扩展到研发流程中的规划、验证和交付环节。',
        } },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${toutiao}/` },
        output: { status: 'completed', url: `${toutiao}/`, engine: 'scrapling', result: {
          title: '', url: `${toutiao}/`,
          body: JSON.stringify({ formatted: '', format: 'markdown', title: '', text: '', url: `${toutiao}/` }),
        } },
      },
      {
        name: 'crawl', status: 'completed', input: { url: `${toutiao}/` },
        output: { status: 'completed', url: `${toutiao}/`, engine: 'playwright', result: {
          title: '今日头条', url: `${toutiao}/`, body: '# 今日头条\n\n今日头条\n您需要允许该网站执行 JavaScript',
        } },
      },
    ]), 10_000, harnessSeed);
    const ledger = JSON.parse((packet.split('\n').find((line) => line.startsWith('ledger=')) || 'ledger={}').slice(7));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].canonicalUrl).toBe(harnessSeed.link);
    expect(ledger.entries.some((entry: any) => entry.canonicalUrl.includes('toutiao.com'))).toBe(false);
    expect(ledger.toolSummary.successfulCrawlRequests).toBe(3);
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
    expect(captured.jsonSchema.schema.properties.publishTime).toBeUndefined();
    expect(captured.messages[0].content).toContain('Quote0 服务器会自行生成 researchReceipt');
    expect(captured.messages[0].content).toContain('publishTime');
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
          attempt: 2,
          usage: { input: 100, output: 40, total: 140, cacheRead: 5 },
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.policyViolation).toBe(false);
    expect(result.artifact?.title).toBe('MCP新规范取消会话');
    expect(result.artifact?.message).toBe('MCP新规范取消协议会话和初始化握手；请求新增Mcp-Method与Mcp-Name标头，网关可据此路由和限流。');
    expect(result.artifact?.source).toBe('InfoQ 中文');
    expect(result.artifact?.highlights).toBeUndefined();
    expect(result.artifact?.metadata?.researchArtifactOwnership).toBe('quote0-server/v1');
    expect(result.artifact?.publishTime).toBe('2026-08-17T00:00:00.000Z');
    expect(result.artifact?.metadata?.publishTimeSource).toBe('seed');
    expect(result.artifact?.metadata?.researchReceipt?.threadId).toBe('phase-a-thread');
    expect(result.artifact?.metadata?.researchReceipt?.seed?.sourceId).toBe('infoq-cn');
    expect(result.artifact?.metadata?.researchReceipt?.seed?.publishTime).toBe('2026-08-17T00:00:00.000Z');
    expect(result.artifact?.metadata?.researchReceipt?.sources).toEqual([
      expect.objectContaining({ id: 'E1', url: 'https://modelcontextprotocol.io/example', role: 'secondary' }),
    ]);
    expect(result.artifact?.metadata?.researchReceipt?.claims).toEqual([
      { text: 'MCP新规范取消协议会话和初始化握手', sourceIds: ['E1'], status: 'supported' },
      { text: '请求新增Mcp-Method与Mcp-Name标头，网关可据此路由和限流', sourceIds: ['E1'], status: 'supported' },
    ]);
    expect(result.artifact?.metadata?.displayProvenance).toEqual(expect.objectContaining({
      schemaVersion: 'quote0-display-provenance/v1',
      publisher: expect.objectContaining({ label: 'InfoQ 中文', derivedFrom: 'rss-registry' }),
      research: expect.objectContaining({ agent: 'neuromancer', evidenceSourceCount: 1 }),
    }));
    expect(result.artifact?.metadata?.researchReceipt?.usage?.providerReportedTokens).toEqual({
      status: 'reported', input: 100, output: 40, total: 140, cacheRead: 5,
    });
    expect(result.artifact?.metadata?.researchReceipt?.usage?.llmCalls).toBe(2);
  });

  it('fails closed when a digest finalizer only translates or restates the headline', () => {
    const icelandSeed = {
      title: 'Iceland rejects reopening talks on EU entry',
      content: 'Article URL: https://www.ft.com/content/iceland-eu Comments URL: https://news.ycombinator.com/item?id=1 Points: 35 # Comments: 34',
      source: 'Hacker News: Front Page',
      link: 'https://www.ft.com/content/iceland-eu',
      category: 'news',
    };
    const digestDecision = triageResearchCandidate({ seed: icelandSeed, universal: true });
    const evidencePacket = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: icelandSeed.link },
        output: { status: 'completed', url: icelandSeed.link, engine: 'stealth', result: { title: icelandSeed.title, url: icelandSeed.link, text: 'The referendum rejected reopening EU accession talks.' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'Iceland EU referendum result RUV' },
        output: { query: 'Iceland EU referendum result RUV', results: [{ title: 'Iceland rejects EU accession talks', url: 'https://www.ruv.is/english/iceland-eu', content: 'Referendum result and turnout', engine: 'anysearch', score: 0.9 }] },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://www.ruv.is/english/iceland-eu' },
        output: { status: 'completed', url: 'https://www.ruv.is/english/iceland-eu', engine: 'stealth', result: { title: 'Iceland rejects EU accession talks', url: 'https://www.ruv.is/english/iceland-eu', text: 'The No side won 52.8%; the government will not reopen accession talks.' } },
      },
    ]), 5_000, icelandSeed);

    expect(digestDecision.researchMode).toBe('digest');
    const result = materializeStructuredResearchFinalization({
      runId: 'run-iceland-title-only',
      phaseAThreadId: 'phase-a-thread',
      seed: icelandSeed,
      evidencePacket,
      decision: digestDecision,
      runtime: { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 },
      finalization: {
        candidate: {
          titleCandidates: ['冰岛拒绝重启入欧谈判', '冰岛否决重启入欧谈判', '冰岛拒绝恢复入欧谈判'],
          facts: [{ text: '冰岛拒绝重启加入欧盟的谈判', evidenceIds: ['E1', 'E3'] }],
          linkEvidenceId: 'E3',
        },
        telemetry: {
          mode: 'structured-inference', providerId: 'local-qwen', model: 'qwen3.8-27b', latencyMs: 900, attempt: 1,
        },
      },
    });

    expect(result.artifact).toBeUndefined();
    expect(result.policyViolation).toBe(false);
    expect(result.errors.join(' ')).toContain('facts 至少 2 项');
  });

  it('still rejects a digest that pads the headline into two equivalent facts', () => {
    const icelandSeed = {
      title: 'Iceland rejects reopening talks on EU entry',
      content: 'Referendum coverage with independent evidence.',
      source: 'Hacker News: Front Page',
      link: 'https://www.ft.com/content/iceland-eu',
      category: 'news',
    };
    const digestDecision = triageResearchCandidate({ seed: icelandSeed, universal: true });
    const evidencePacket = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: icelandSeed.link },
        output: { status: 'completed', url: icelandSeed.link, result: { title: icelandSeed.title, url: icelandSeed.link, text: 'Canonical evidence.' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'Iceland EU accession referendum result' },
        output: { query: 'Iceland EU accession referendum result', results: [{ title: 'Iceland rejects EU accession talks', url: 'https://www.ruv.is/english/iceland-eu', content: 'Independent result coverage', engine: 'anysearch', score: 0.9 }] },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://www.ruv.is/english/iceland-eu' },
        output: { status: 'completed', url: 'https://www.ruv.is/english/iceland-eu', result: { title: 'Iceland rejects EU accession talks', url: 'https://www.ruv.is/english/iceland-eu', text: 'Independent evidence.' } },
      },
    ]), 5_000, icelandSeed);
    const result = materializeStructuredResearchFinalization({
      runId: 'run-iceland-double-restatement',
      phaseAThreadId: 'phase-a-thread',
      seed: icelandSeed,
      evidencePacket,
      decision: digestDecision,
      runtime: { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 },
      finalization: {
        candidate: {
          titleCandidates: ['冰岛拒绝重启入欧谈判', '冰岛否决恢复入欧谈判', '冰岛拒绝恢复入欧谈判'],
          facts: [
            { text: '冰岛拒绝重启加入欧盟谈判', evidenceIds: ['E1', 'E3'] },
            { text: '冰岛拒绝恢复入欧谈判', evidenceIds: ['E1', 'E3'] },
          ],
          linkEvidenceId: 'E3',
        },
        telemetry: {
          mode: 'structured-inference', providerId: 'local-qwen', model: 'qwen3.8-27b', latencyMs: 900, attempt: 2,
        },
      },
    });

    expect(result.artifact).toBeUndefined();
    expect(result.errors.join(' ')).toContain('Research 信息增益不足');
  });

  it('rejects a headline that drifts to a different evidence topic than the selected facts', () => {
    const reportSeed = {
      title: 'InfoQ 2026 年云计算与 DevOps 趋势报告',
      content: '点击查看原文>',
      source: 'InfoQ',
      link: 'https://www.infoq.cn/article/cloud-devops-2026',
      category: 'news',
    };
    const recoveryDecision = triageResearchCandidate({ seed: reportSeed, universal: true });
    const evidencePacket = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: reportSeed.link },
        output: { status: 'completed', url: reportSeed.link, result: { title: reportSeed.title, url: reportSeed.link, text: 'InfoQ发布2026年云计算与DevOps趋势报告，面向软件架构师总结年度技术变化。' } },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://www.linuxfoundation.org/press/aaif' },
        output: { status: 'completed', url: 'https://www.linuxfoundation.org/press/aaif', result: { title: 'Linux Foundation announces AAIF', url: 'https://www.linuxfoundation.org/press/aaif', text: 'Linux基金会成立Agentic AI基金会，并接收MCP、goose和AGENTS.md等项目贡献。' } },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://www.thousandeyes.com/blog/aws-outage' },
        output: { status: 'completed', url: 'https://www.thousandeyes.com/blog/aws-outage', result: { title: 'AWS outage analysis', url: 'https://www.thousandeyes.com/blog/aws-outage', text: 'AWS us-east-1故障导致多个网站服务中断。' } },
      },
    ]), 8_000, reportSeed);
    const result = materializeStructuredResearchFinalization({
      runId: 'run-cross-topic-title',
      phaseAThreadId: 'phase-a-thread',
      seed: reportSeed,
      evidencePacket,
      decision: recoveryDecision,
      runtime: { toolCalls: 3, searchRequests: 0, crawlRequests: 3, failedToolCalls: 0 },
      finalization: {
        candidate: {
          titleCandidates: ['AWS美东1区故障致多网站宕机', 'AWS云故障波及多站点', '美东AWS故障引发服务中断'],
          facts: [
            { text: 'InfoQ发布了2026年云计算与DevOps趋势报告，旨在为软件架构师提供年度技术洞察', evidenceIds: ['E1'] },
            { text: 'Linux基金会宣布成立Agentic AI基金会，并接收MCP、goose和AGENTS.md等项目贡献', evidenceIds: ['E2'] },
          ],
          linkEvidenceId: 'E1',
        },
        telemetry: {
          mode: 'structured-inference', providerId: 'local-qwen', model: 'qwen3.8-27b', latencyMs: 900, attempt: 1,
        },
      },
    });

    expect(recoveryDecision.researchMode).toBe('recovery');
    expect(result.artifact).toBeUndefined();
    expect(result.policyViolation).toBe(false);
    expect(result.errors.join(' ')).toContain('标题不能从 Evidence Packet 的其他话题漂移');
  });

  it('rejects a universal enrichment card that still collapses to one sparse fact', () => {
    const benqSeed = {
      title: '屏幕之外，桌面之上：走过十年，明基探索了一束光的更多可能',
      content: '明基回顾其照明产品十年发展历程。',
      source: '少数派',
      link: 'https://sspai.com/post/benq-light-ten-years',
      category: 'news',
    };
    const enrichmentDecision = triageResearchCandidate({ seed: benqSeed, universal: true });
    const evidencePacket = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: benqSeed.link },
        output: { status: 'completed', url: benqSeed.link, result: { title: benqSeed.title, url: benqSeed.link, text: '明基在走过十年的发展历程中，持续探索屏幕之外、桌面之上的一束光的更多可能性。' } },
      },
      {
        name: 'search', status: 'completed', input: { q: '明基 一束光 十年 照明' },
        output: { query: '明基 一束光 十年 照明', results: [] },
      },
    ]), 6_000, benqSeed);
    const result = materializeStructuredResearchFinalization({
      runId: 'run-benq-sparse',
      phaseAThreadId: 'phase-a-thread',
      seed: benqSeed,
      evidencePacket,
      decision: enrichmentDecision,
      runtime: { toolCalls: 2, searchRequests: 1, crawlRequests: 1, failedToolCalls: 0 },
      finalization: {
        candidate: {
          titleCandidates: ['明基十年深耕一束光应用', '明基探索桌面照明十年', '明基回顾十年照明实践'],
          facts: [{ text: '明基在走过十年的发展历程中，持续探索屏幕之外、桌面之上的一束光的更多可能性', evidenceIds: ['E1'] }],
          linkEvidenceId: 'E1',
        },
        telemetry: {
          mode: 'structured-inference', providerId: 'local-qwen', model: 'qwen3.8-27b', latencyMs: 900, attempt: 1,
        },
      },
    });

    expect(enrichmentDecision.researchMode).toBe('enrichment');
    expect(result.artifact).toBeUndefined();
    expect(result.policyViolation).toBe(false);
    expect(result.errors.join(' ')).toContain('Universal Research 不能退化成单条事实');
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

  it('fails closed when a recovery artifact exceeds its seven-source/five-claim cap', async () => {
    const candidate = validCandidate() as any;
    candidate.metadata.researchReceipt.sources.push(
      { id: 'extra1', url: 'https://example.com/extra1', role: 'secondary' },
      { id: 'extra2', url: 'https://example.com/extra2', role: 'secondary' },
      { id: 'extra3', url: 'https://example.com/extra3', role: 'secondary' },
      { id: 'extra4', url: 'https://example.com/extra4', role: 'secondary' },
      { id: 'extra5', url: 'https://example.com/extra5', role: 'secondary' },
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

  it('routes the Phase B mode from QUOTE0_RESEARCH_PHASE_B_MODE with the legacy default preserved', () => {
    expect(getResearchCanaryConfig({}).phaseBMode).toBe('structured-inference');
    expect(getResearchCanaryConfig({ QUOTE0_RESEARCH_STRUCTURED_FINALIZER: 'false' } as NodeJS.ProcessEnv).phaseBMode).toBe('agent-job');
    expect(getResearchCanaryConfig({ QUOTE0_RESEARCH_PHASE_B_MODE: 'terminal-tool' } as NodeJS.ProcessEnv)).toEqual(
      expect.objectContaining({ phaseBMode: 'terminal-tool', structuredFinalizer: false }),
    );
    expect(getResearchCanaryConfig({ QUOTE0_RESEARCH_PHASE_B_MODE: 'structured-inference' } as NodeJS.ProcessEnv)).toEqual(
      expect.objectContaining({ phaseBMode: 'structured-inference', structuredFinalizer: true }),
    );
  });

  it('lifts an explicit universal flag into the same universal hard gates as the auto worker', () => {
    // Default manual canary must remain unchanged: no universal reason, min fact count 1.
    const defaultDecision = triageResearchCandidate({ seed, manual: true });
    expect(defaultDecision.reasons).not.toContain('universal-evidence');
    expect(minimumEditorialFactCount(defaultDecision)).toBe(1);

    const universalDecision = triageResearchCandidate({ seed, manual: true, universal: true });
    expect(universalDecision.reasons).toContain('universal-evidence');
    expect(minimumEditorialFactCount(universalDecision)).toBe(2);
  });

  it('reproduces the capacity rejection when terminal-tool facts are ~95 CJK chars each', () => {
    // Regression for the v1.21.125 canaries (run 0372305f / 8ed1e837 / 4e432ebb / b423be4c):
    // the model wrote 3 facts of roughly 95-100 CJK chars, so under the existing packing rule
    // (title <=22 units → 280 body units ≈ 2 units per CJK) only the first fact fits.
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。'.repeat(4),
      source: 'Example',
      link: 'https://example.com/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    expect(digestDecision.researchMode).toBe('digest');
    expect(minimumEditorialFactCount(digestDecision)).toBe(2);

    const evidencePacket = buildResearchEvidencePacket(phaseATurns([
      {
        name: 'crawl', status: 'completed', input: { url: digestSeed.link },
        output: { status: 'completed', url: digestSeed.link, engine: 'scrapling', result: { title: digestSeed.title, url: digestSeed.link, text: 'Seed canonical body with product update details and a changelog number.' } },
      },
      {
        name: 'search', status: 'completed', input: { q: 'product update provenance' },
        output: { query: 'product update provenance', results: [{ title: 'Independent coverage', url: 'https://independent.example/report', content: 'Independent report', engine: 'anysearch', score: 0.9 }] },
      },
      {
        name: 'crawl', status: 'completed', input: { url: 'https://independent.example/report' },
        output: { status: 'completed', url: 'https://independent.example/report', engine: 'scrapling', result: { title: 'Independent coverage', url: 'https://independent.example/report', text: 'Independent report corroborating the update.' } },
      },
    ]), 6_000, digestSeed);

    // ~95 CJK chars (≈190 display units) each — the shape that triggered the v1.21.125 rejections.
    const longFactText = '根据独立平台今日发布的产品版本说明本次更新将分阶段开放并逐步覆盖到全体用户而离线模式会在更新完成后默认开启以便在网络断开时依然可以查看内容并且启动速度有明显改善'.repeat(1);
    const longFacts = Array.from({ length: 3 }, () => ({
      text: longFactText,
      evidenceIds: ['E1'],
    }));

    const result = materializeStructuredResearchFinalization({
      runId: 'run-capacity-repro',
      phaseAThreadId: 'thread-a',
      seed: digestSeed,
      evidencePacket,
      decision: digestDecision,
      runtime: { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 },
      finalization: {
        candidate: {
          titleCandidates: ['产品更新分阶段开放', '产品更新默认开离线模式', '产品推送离线与提速'],
          facts: longFacts,
          linkEvidenceId: 'E1',
        },
        telemetry: { mode: 'terminal-tool', providerId: 'server', model: 'server-adjudication', latencyMs: 1, attempt: 1 },
      },
    });

    expect(result.artifact).toBeUndefined();
    expect(result.policyViolation).toBe(false);
    expect(result.errors.join(' ')).toContain('正文容量内只保留了 1 条完整事实');
  });

  it('tells the terminal-tool prompt the fact length budget and the reject-and-shorten correction', () => {
    const digestSeed = {
      title: '普通产品更新',
      content: '产品新增离线模式，并改善启动速度。团队同时调整设置页结构，旧配置仍保持兼容；更新会分阶段开放。'.repeat(4),
      source: 'Example',
      link: 'https://example.com/update',
      category: 'technology',
    };
    const digestDecision = triageResearchCandidate({ seed: digestSeed, universal: true });
    const prompt = buildNeuromancerTerminalFinalizationPrompt(
      digestSeed,
      'version=quote0-evidence-packet/v1\nledger={\"entry\":1}',
      'run-1',
      digestDecision,
      [],
      { title: 'Direct', message: 'Direct' },
    );

    expect(prompt).toContain('第 1、2 条各**不超过 55 个中文字**');
    expect(prompt).toContain('所有 facts 的 text 总字数**不超过 110');
    expect(prompt).toContain('给正文留满 280 units');
    expect(prompt).toContain('不要自行合并事实');
    expect(prompt).toContain('正文容量内只保留了 1 条完整事实');
    expect(prompt).toContain('不要删掉第二条事实');
    expect(prompt).toContain('缩短到 55 个中文字以内');
  });

  it('dispatches the terminal-tool continuation on the SAME thread with a single non-terminal call budget', async () => {
    let captured: any;
    let capturedHeaders: Headers | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ jobId: 'job-terminal', threadId: 'thread-a' }, 202);
    }) as typeof fetch;

    const dispatched = await dispatchResearchTerminalFinalization(
      'run-1', 'thread-a', seed, 'version=quote0-evidence-packet/v1\n[EVIDENCE 1] output=official',
      seedDecision, { errors: ['titleCandidates 标题漂移'] }, finalizerConfig, fetchImpl,
    );

    expect(dispatched).toEqual({ jobId: 'job-terminal', threadId: 'thread-a' });
    expect(capturedHeaders?.get('x-straylight-max-tool-calls')).toBe('1');
    expect(captured.threadId).toBe('thread-a');
    expect(captured.providerId).toBe('local-qwen');
    expect(captured.message).toContain('finish_research_turn');
    expect(captured.message).toContain('runId');
    expect(captured.message).toContain('run-1');
    expect(captured.message).toContain('titleCandidates 标题漂移');

    // Thread drift must fail closed.
    const driftFetch = (async () => jsonResponse({ jobId: 'job-terminal', threadId: 'thread-other' }, 202)) as typeof fetch;
    await expect(dispatchResearchTerminalFinalization('run-1', 'thread-a', seed, 'packet', seedDecision, {}, finalizerConfig, driftFetch))
      .rejects.toThrow('thread 漂移');
  });

  it('rejects terminal candidate shapes the structured schema does not allow (extra fields, wrong cardinality)', () => {
    const schema = structuredFinalizationSchema('run-1', seedDecision, validGroundingPacket());

    expect(validateResearchCandidateShape(schema, validEditorialDecision())).toEqual([]);

    const extraField = validateResearchCandidateShape(schema, {
      ...validEditorialDecision(),
      source: '模型伪造来源',
    });
    expect(extraField.join(' ')).toContain('不允许的字段 source');

    const twoTitles = validateResearchCandidateShape(schema, {
      ...validEditorialDecision(),
      titleCandidates: ['只有一个标题', '只有两个标题'],
    });
    expect(twoTitles.join(' ')).toContain('至少需要 3 项');

    const badEvidence = validateResearchCandidateShape(schema, {
      ...validEditorialDecision(),
      facts: [{ text: 'MCP 新规范', evidenceIds: ['E9'] }],
    });
    expect(badEvidence.join(' ')).toContain('必须是 E1|E2 之一');
  });

  it('inspects a terminal thread that calls only finish_research_turn and completes from the server receipt', async () => {
    const receipt = {
      attempt: 2,
      outcome: 'accepted' as const,
      errors: [],
      candidate: validEditorialDecision(),
      artifact: validCandidate() as any,
      receivedAt: new Date().toISOString(),
    };
    const terminalTurns = [
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'crawl', status: 'completed' }] },
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'finish_research_turn', status: 'completed' }] },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-terminal')) return jsonResponse({ jobId: 'job-terminal', threadId: 'thread-a', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-a')) return jsonResponse({ turns: terminalTurns });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-terminal', threadId: 'thread-a',
      phase: 'terminal-finalization', priorRuntime: phaseARuntime, terminalReceipt: receipt,
    }, config, fetchImpl);

    expect(result.status).toBe('completed');
    expect(result.retryable).toBe(false);
    expect(result.artifact?.title).toBe(validCandidate().title);
  });

  it('invalidates a terminal phase that calls any non-terminal tool (crawl first)', async () => {
    const terminalTurns = [
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'crawl', status: 'completed' }] },
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'crawl', status: 'completed' }] },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-terminal')) return jsonResponse({ jobId: 'job-terminal', threadId: 'thread-a', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-a')) return jsonResponse({ turns: terminalTurns });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-terminal', threadId: 'thread-a', phase: 'terminal-finalization',
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(false);
    expect(result.errors.join(' ')).toContain('违反 no-tools 契约');
    expect(result.errors.join(' ')).toContain('crawl');
  });

  it('fails a terminal phase that ended without invoking finish_research_turn and allows one retry', async () => {
    const terminalTurns = [
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'crawl', status: 'completed' }] },
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [{ type: 'text', text: '我没有调用工具' }], toolCalls: [] },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-terminal')) return jsonResponse({ jobId: 'job-terminal', threadId: 'thread-a', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-a')) return jsonResponse({ turns: terminalTurns });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-terminal', threadId: 'thread-a', phase: 'terminal-finalization',
    }, config, fetchImpl);

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.errors.join(' ')).toContain('finish_research_turn');
  });

  it('treats a rejected terminal receipt as invalid and carries its errors for retry', async () => {
    const receipt = {
      attempt: 2,
      outcome: 'rejected' as const,
      errors: ['facts 至少 2 项', '标题漂移'],
      candidate: validEditorialDecision(),
      receivedAt: new Date().toISOString(),
    };
    const terminalTurns = [
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'crawl', status: 'completed' }] },
      { participantType: 'user', source: { identity: researchCanaryIdentity('run-1') }, blocks: [], toolCalls: [] },
      { participantType: 'agent', state: 'completed', blocks: [], toolCalls: [{ name: 'finish_research_turn', status: 'completed' }] },
    ];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs/job-terminal')) return jsonResponse({ jobId: 'job-terminal', threadId: 'thread-a', status: 'completed', response: '' });
      if (url.endsWith('/threads/thread-a')) return jsonResponse({ turns: terminalTurns });
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const result = await inspectResearchCanary({
      runId: 'run-1', seed, decision: seedDecision, jobId: 'job-terminal', threadId: 'thread-a',
      phase: 'terminal-finalization', terminalReceipt: receipt,
    }, config, fetchImpl);

    expect(result.status).toBe('invalid');
    expect(result.retryable).toBe(true);
    expect(result.errors.join(' ')).toContain('facts 至少 2 项');
    expect(result.errors.join(' ')).toContain('标题漂移');
  });
});
