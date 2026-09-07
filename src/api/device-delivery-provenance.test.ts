import { describe, expect, it } from 'bun:test';
import { buildRenderableFromInventory } from './device-delivery-worker.js';

describe('device delivery provenance projection', () => {
  it('retrofits existing v12 Research inventory with server-owned publisher metadata', () => {
    const rendered = buildRenderableFromInventory({
      id: 19049,
      source: 'hackernews',
      title: 'raw',
      raw_content: {
        title: 'Meta AI Agent',
        source: 'Hacker News: Front Page',
        link: 'https://au.pcmag.com/ai/116091/story',
      },
      processed_content: {
        title: 'Meta AI Agent误删邮件',
        message: '研究正文。',
        source: 'x.com',
        signature: '神经漫游者',
        metadata: {
          researchGate: {
            state: 'ready',
            researchPolicyVersion: 'quote0-research-triage/v12',
            researchRunId: 'run-49',
          },
          researchReceipt: {
            agent: 'neuromancer',
            runId: 'run-49',
            seed: {
              title: 'Meta AI Agent',
              source: 'Hacker News: Front Page',
              link: 'https://au.pcmag.com/ai/116091/story',
            },
            sources: [{ id: 'E5', url: 'https://x.com/researcher/status/1', role: 'secondary' }],
            claims: [{ text: '研究正文', sourceIds: ['E5'], status: 'supported' }],
          },
        },
      },
    });

    expect(rendered.source).toBe('PCMag');
    expect(rendered.metadata.displayProvenance).toEqual(expect.objectContaining({
      publisher: expect.objectContaining({ label: 'PCMag', derivedFrom: 'seed-link' }),
      discovery: { sourceId: 'hackernews', label: 'Hacker News' },
      research: expect.objectContaining({ agent: 'neuromancer', evidenceSourceCount: 1 }),
    }));
    expect(rendered.metadata.researchReceipt.runId).toBe('run-49');
  });

  it('does not invent Research provenance for ordinary inventory', () => {
    const rendered = buildRenderableFromInventory({
      id: 1,
      source: 'solidot',
      raw_content: { source: '奇客Solidot', link: 'https://www.solidot.org/story?sid=1' },
      processed_content: { title: '普通新闻', message: '正文', source: 'Solidot', signature: 'RSS智能' },
    });
    expect(rendered.source).toBe('Solidot');
    expect(rendered.metadata).toBeUndefined();
  });
});
