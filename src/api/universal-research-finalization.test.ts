import { describe, expect, test } from 'bun:test';
import {
  applyUniversalResearchArtifact,
  universalGroundingErrors,
} from './universal-research-finalization.js';
import { markUniversalResearchPending } from './universal-research-policy.js';

function runRecord() {
  return {
    id: 'run-u1',
    trigger: 'inventory-auto',
    sourceInventoryId: 42,
    triage: { researchMode: 'digest' },
    runtimeReceipt: { toolCalls: 3, searchRequests: 1, crawlRequests: 2, failedToolCalls: 0 },
    evidenceSnapshot: 'evidence packet',
  } as any;
}

function artifact() {
  return {
    id: 'quote0-neuromancer-run-u1',
    title: '证据消化后的标题',
    message: '证据消化后的正文，保留已核验事实并去掉未经支持的断言。',
    signature: '神经漫游者',
    source: '官方/原文',
    publishTime: '2026-08-21T00:00:00.000Z',
    category: 'news',
    link: 'https://example.com/story',
    highlights: ['证据'],
    metadata: {
      researchReceipt: {
        schemaVersion: 'neuromancer-research/v1',
        agent: 'neuromancer',
        sources: [{ id: 'seed', url: 'https://example.com/story', title: 'Story', role: 'primary' }],
        claims: [{ text: '证据消化后的正文', sourceIds: ['seed'], status: 'supported' }],
        retrieval: { status: 'healthy', enginesUsed: ['crawl'], unavailableEngines: [] },
      },
    },
  } as any;
}

describe('universal Research finalization', () => {
  test('requires every publishable Receipt claim to be supported', () => {
    const supported = artifact();
    expect(universalGroundingErrors(supported)).toEqual([]);
    const unresolved = artifact();
    unresolved.metadata.researchReceipt.claims[0].status = 'unresolved';
    expect(universalGroundingErrors(unresolved)[0]).toContain('只允许 supported claim');
  });

  test('replaces a pending Direct inventory item only after Research finalization and re-render', async () => {
    let current: any = {
      id: 42,
      processed_content: markUniversalResearchPending({
        title: 'Direct draft',
        message: 'draft',
        metadata: {},
      }, new Date('2026-08-21T00:00:00.000Z')),
      image_path: '/old.png',
    };
    const db = {
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT id, processed_content')) return { rows: [current] };
        if (sql.includes('UPDATE content_inventory')) {
          current = {
            ...current,
            processed_content: JSON.parse(String(params[1])),
            image_path: params[2],
          };
          return { rows: [{ id: 42 }] };
        }
        if (sql.includes('SELECT processed_content')) return { rows: [current] };
        return { rows: [] };
      },
    } as any;

    const result = await applyUniversalResearchArtifact(db, {
      run: runRecord(),
      artifact: artifact(),
      now: new Date('2026-08-21T00:02:00.000Z'),
      renderArtifact: async () => '/grounded.png',
    });

    expect(result).toEqual(expect.objectContaining({ applied: true, inventoryId: 42, imagePath: '/grounded.png' }));
    expect(current.processed_content.title).toBe('证据消化后的标题');
    expect(current.processed_content.metadata.researchGate).toEqual(expect.objectContaining({
      state: 'ready',
      researchRunId: 'run-u1',
      researchMode: 'digest',
    }));
  });

  test('does not rewrite legacy inventory that never opted into the universal gate', async () => {
    const db = {
      query: async () => ({ rows: [{ id: 42, processed_content: { title: 'legacy', message: 'legacy' }, image_path: '/old.png' }] }),
    } as any;
    const result = await applyUniversalResearchArtifact(db, {
      run: runRecord(),
      artifact: artifact(),
      renderArtifact: async () => { throw new Error('must not render'); },
    });
    expect(result.reason).toBe('not-universal-pending');
  });
});
