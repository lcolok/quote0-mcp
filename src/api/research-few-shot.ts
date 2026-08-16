import type { ResearchSeed, ResearchTriageDecision } from './research-triage.js';
import { NEUROMANCER_RESEARCH_RECEIPT_VERSION } from './renderable-news-intake.js';

export const EINK_NEWS_FEW_SHOT_VERSION = 'eink-news-few-shot/v1';
export const RESEARCH_PHASE_A_DONE = 'RESEARCH_PHASE_A_DONE';

export interface EinkNewsFewShot {
  id: string;
  contentClass: 'legal-high-risk' | 'deep-reading' | 'technical-architecture';
  title: string;
  message: string;
}

export const EINK_NEWS_FEW_SHOTS: readonly EinkNewsFewShot[] = [
  {
    id: 'kalshi-geofence',
    contentClass: 'legal-high-risk',
    title: '州法官令Kalshi停售体育赌注',
    message: '华盛顿州法官下令Kalshi停止在该州提供体育等投注，须实施地理围栏限制，屏蔽本地用户访问其赌注服务。',
  },
  {
    id: 'neuroprivacy',
    contentClass: 'deep-reading',
    title: '苹果MetaSnap推神经监测引隐私忧',
    message: '苹果、Meta等科技巨头推消费级神经技术产品，监测解读脑活动。专家警告神经数据成隐私新焦点，呼吁“神经权利”护精神隐私。',
  },
  {
    id: 'mcp-tool-surface',
    contentClass: 'technical-architecture',
    title: 'MCP工具面精简至3域工具',
    message: '文章提出MCP工具面优化：将Jira、GitLab等数十种底层操作收敛为3–5个领域工具，用action路由，保留能力同时缩减模型可见工具面。',
  },
] as const;

function renderFewShots(): string {
  return EINK_NEWS_FEW_SHOTS.map((item, index) => [
    `${index + 1}) [${item.contentClass}]`,
    `title=${item.title}`,
    `message=${item.message}`,
  ].join('\n')).join('\n\n');
}

function seedPayload(seed: ResearchSeed, contentLimit?: number): string {
  const rawContent = seed.content || '';
  const content = contentLimit && rawContent.length > contentLimit
    ? rawContent.slice(0, contentLimit)
    : rawContent;
  return JSON.stringify({
    title: seed.title,
    ...(content ? { content } : {}),
    ...(seed.source ? { source: seed.source } : {}),
    ...(seed.link ? { link: seed.link } : {}),
    ...(seed.category ? { category: seed.category } : {}),
  }, null, 2);
}

function finalJsonContract(runId: string, maxClaims: number): string {
  return `最终只输出一个可被 JSON.parse 直接解析的 JSON object，不要 Markdown、代码围栏、研究过程或前后解释。真正输出必须是单行紧凑 JSON：不要缩进、不要换行、不要重复字段。契约：
{
  "id": "quote0-neuromancer-${runId}",
  "title": "简短中文标题",
  "message": "约55~80个中文字符，只保留2~3个最高价值且已核验事实",
  "signature": "神经漫游者",
  "source": "不超过18字符的关键来源组合",
  "publishTime": "ISO-8601时间",
  "category": "news",
  "link": "最适合继续阅读的canonical/原始URL",
  "highlights": ["2~4个正文中实际出现的短关键词"],
  "metadata": {
    "fewShotVersion": "${EINK_NEWS_FEW_SHOT_VERSION}",
    "researchReceipt": {
      "schemaVersion": "${NEUROMANCER_RESEARCH_RECEIPT_VERSION}",
      "agent": "neuromancer",
      "sources": [
        {"id":"source-id","url":"https://...","title":"来源标题","role":"seed|primary|official|secondary|syndicated|community"}
      ],
      "claims": [
        {"text":"最终卡片中的可核验主张","sourceIds":["source-id"],"status":"supported|context|unresolved|conflict"}
      ],
      "retrieval": {"status":"healthy|degraded|unknown","enginesUsed":["实际使用的引擎"],"unavailableEngines":["实际不可用的引擎"]}
    }
  }
}

Quote0 会自行注入 threadId/runId/generatedAt/真实工具计数和 token telemetry 状态；不要编造 usage/token 数值。
硬约束：title 最多约16个全角字的视觉量；message 最多约80个全角字；highlights 必须逐字出现在 message；sources 总数最多 3（seed + 最多2个最关键来源）；claims 最多 ${maxClaims}；source.note 默认省略，只有确实需要解释来源角色时才写且不超过80字符；不写“详情见原文”“引发关注”等空话。`;
}

/** Phase A: only collect evidence. Quote0 compacts tool outputs deterministically afterwards. */
export function buildNeuromancerResearchPrompt(
  seed: ResearchSeed,
  decision: ResearchTriageDecision,
  runId: string,
): string {
  if (decision.lane !== 'research' || !decision.budget) {
    throw new Error('只有 research lane 才能构建 Neuromancer Research prompt');
  }
  const budget = decision.budget;
  return `你是“神经漫游者”。这是 Quote0 bounded research canary 的 Phase A：只负责检索和事实核验，不负责写最终新闻卡片。
run=${runId}；policy=${decision.policyVersion}；触发原因=${decision.reasons.join(',')}。

研究预算：
- 最多 ${budget.maxToolCalls} 次工具调用；达到上限立即停止。
- canonical seed URL 可访问时优先 crawl；随后只追踪最关键上游 provenance/official/primary source。
- seed 之外最多形成 ${budget.maxPostSeedArtifacts} 个高价值来源制品；禁止为了数量无边界扩搜。
- 不要向用户提问，不要产生 ask_user / interaction。
- 网页失败时允许 degraded；无法核验的事实不要硬补。

Seed：
${seedPayload(seed)}

Phase A 完成后不要写新闻、不要写 JSON、不要解释研究过程；只输出精确标记：${RESEARCH_PHASE_A_DONE}
即使运行时在工具调用后没有产生该标记，Quote0 也会从持久 thread 的 tool evidence 做确定性恢复。`;
}

/** Phase B: new thread, compact evidence only, and absolutely no tools. */
export function buildNeuromancerEvidenceFinalizationPrompt(
  seed: ResearchSeed,
  evidencePacket: string,
  runId: string,
  errors: string[] = [],
): string {
  const errorSection = errors.length
    ? `\n此前 finalization 未通过 Quote0 validator，只修正以下问题，不新增事实：\n${errors.map((error) => `- ${error}`).join('\n')}\n`
    : '';
  return `你是“神经漫游者”。这是 Quote0 bounded research canary 的 Phase B finalizer。Phase A 已结束；下面的 Evidence Packet 是 Quote0 从真实 tool output 确定性压缩得到的唯一证据集。

绝对禁止调用任何工具，禁止 search/crawl/browser，禁止向用户提问。只基于 Seed + Evidence Packet 生成最终卡片；证据不足就删掉主张或标 unresolved，不得自行补资料。

Seed（Phase B 只携带最多1000字符正文快照；完整 seed 已由 Quote0 领域存储持久化）：
${seedPayload(seed, 1000)}

Evidence Packet：
${evidencePacket}
${errorSection}
296×152 文案 few-shot（version=${EINK_NEWS_FEW_SHOT_VERSION}；只学习信息密度、长度和中文表达，不复制事实）：
${renderFewShots()}

${finalJsonContract(runId, 4)}`;
}
