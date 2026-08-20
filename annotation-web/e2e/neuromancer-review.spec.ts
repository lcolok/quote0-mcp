import { expect, test } from '@playwright/test';

const RUN_ID = '82306199-5030-47db-a3f8-e3046cbc8d96';

const blindPair = {
  success: true,
  data: {
    version: 'neuromancer-paired-review/v1',
    runId: RUN_ID,
    sourceInventoryId: 18246,
    subject: {
      title: 'Debian Starts Voting on AI/LLM Contributions for Future Development',
      source: 'DEV Community',
    },
    sideA: {
      title: 'Debian表决LLM贡献政策',
      message: 'Debian 2026年发起关于LLM贡献政策的正式表决。',
    },
    sideB: {
      title: 'Debian投票定AI/LLM贡献政策',
      message: 'Debian启动投票，决定AI/LLM贡献处理方式。',
    },
    review: null,
    reveal: null,
    changesPhysicalDelivery: false,
  },
};

const revealedPair = {
  success: true,
  data: {
    ...blindPair.data,
    review: {
      id: 1,
      researchRunId: RUN_ID,
      sourceInventoryId: 18246,
      comparisonVersion: 'neuromancer-paired-review/v1',
      researchSide: 'a',
      choice: 'research',
      directScores: { factualConfidence: 3, informationDensity: 3, einkSuitability: 3 },
      researchScores: { factualConfidence: 4, informationDensity: 4, einkSuitability: 4 },
      researchWorthCost: null,
      note: '',
      annotator: 'human',
      createdAt: '2026-08-20T05:00:00.000Z',
      updatedAt: '2026-08-20T05:00:00.000Z',
    },
    reveal: {
      researchSide: 'a',
      direct: {
        title: 'Debian投票定AI/LLM贡献政策',
        message: 'Debian启动投票，决定AI/LLM贡献处理方式。',
        signature: 'AI优化·Q95',
      },
      research: {
        title: 'Debian表决LLM贡献政策',
        message: 'Debian 2026年发起关于LLM贡献政策的正式表决。',
        signature: '神经漫游者',
      },
      researchReceipt: {
        sources: [
          { id: 'debian-vote', role: 'official', title: 'Debian vote', url: 'https://example.com/debian' },
        ],
        claims: [
          { text: 'Debian 正式启动相关表决', status: 'supported', sourceIds: ['debian-vote'] },
        ],
      },
      runtimeReceipt: { toolCalls: 6, searchRequests: 3, crawlRequests: 3 },
      straylightThreadId: 'c1ed6066-56a9-4c09-b494-fa42e8f7191d',
      straylightThreadIds: ['c1ed6066-56a9-4c09-b494-fa42e8f7191d'],
    },
  },
};

test('Neuromancer paired review stays blind until submit, then reveals evidence', async ({ page }) => {
  let savedBlindBody: any = null;
  let savedWorthCost: boolean | null = null;

  await page.route('http://localhost:3001/api/review/neuromancer/candidates?**', (route) => route.fulfill({
    json: {
      success: true,
      count: 1,
      changesPhysicalDelivery: false,
      data: [{
        runId: RUN_ID,
        sourceInventoryId: 18246,
        subjectTitle: blindPair.data.subject.title,
        completedAt: '2026-08-20T00:08:27.338Z',
        reviewed: false,
        reviewChoice: null,
        reviewUpdatedAt: null,
      }],
    },
  }));

  await page.route(`http://localhost:3001/api/review/neuromancer/${RUN_ID}`, (route) => route.fulfill({ json: blindPair }));
  await page.route(`http://localhost:3001/api/review/neuromancer/${RUN_ID}/review`, async (route) => {
    savedBlindBody = route.request().postDataJSON();
    await route.fulfill({ json: revealedPair });
  });
  await page.route(`http://localhost:3001/api/review/neuromancer/${RUN_ID}/cost`, async (route) => {
    const body = route.request().postDataJSON();
    savedWorthCost = body.worthCost;
    await route.fulfill({
      json: {
        success: true,
        data: {
          ...revealedPair.data,
          review: { ...revealedPair.data.review, researchWorthCost: body.worthCost },
        },
      },
    });
  });

  await page.goto('/annotate?view=neuromancer');
  await expect(page.getByRole('heading', { name: '神经漫游者 · 内容增益盲测' })).toBeVisible();
  await expect(page.getByText('Blind · identity hidden')).toHaveCount(2);
  await expect(page.getByText('已揭盲')).toHaveCount(0);
  await expect(page.getByText(/A = 神经漫游者 Research/)).toHaveCount(0);
  await expect(page.getByText('查看 Research Receipt 证据')).toHaveCount(0);
  await expect(page.getByText(/产出者 ·/)).toHaveCount(0);

  for (const button of await page.getByTestId('blind-side-a').getByRole('button', { name: '4' }).all()) await button.click();
  for (const button of await page.getByTestId('blind-side-b').getByRole('button', { name: '3' }).all()) await button.click();
  await page.getByRole('button', { name: '选 A' }).click();
  await page.getByRole('button', { name: '提交盲测并揭示身份' }).click();

  await expect(page.getByText('已揭盲')).toBeVisible();
  await expect(page.getByText(/A = 神经漫游者 Research/)).toBeVisible();
  await expect(page.getByText('Neuromancer Research', { exact: true })).toBeVisible();
  await expect(page.getByText('查看 Research Receipt 证据')).toBeVisible();
  await expect(page.getByRole('link', { name: /Straylight/ })).toBeVisible();

  expect(savedBlindBody).toEqual({
    choice: 'a',
    sideA: { factualConfidence: 4, informationDensity: 4, einkSuitability: 4 },
    sideB: { factualConfidence: 3, informationDensity: 3, einkSuitability: 3 },
    note: '',
  });
  expect(JSON.stringify(savedBlindBody)).not.toContain('research');
  expect(JSON.stringify(savedBlindBody)).not.toContain('神经漫游者');

  await page.getByRole('button', { name: '值得', exact: true }).click();
  await expect.poll(() => savedWorthCost).toBe(true);
});
