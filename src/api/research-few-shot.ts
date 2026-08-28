import type { ResearchSeed, ResearchTriageDecision } from './research-triage.js';
import { NEUROMANCER_RESEARCH_RECEIPT_VERSION } from './renderable-news-intake.js';

export const EINK_NEWS_FEW_SHOT_VERSION = 'eink-news-few-shot/v3';
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

export interface NeuromancerEditorialDraft {
  title?: string;
  message?: string;
}

function editorialDraftPayload(draft: NeuromancerEditorialDraft | undefined): string {
  if (!draft?.title || !draft?.message) return '(none)';
  return JSON.stringify({ title: draft.title, message: draft.message }, null, 2);
}

function finalJsonContract(runId: string, decision: ResearchTriageDecision): string {
  if (!decision.budget) throw new Error('finalization 缺少 Research budget');
  const maxClaims = decision.budget.maxPublishableClaims;
  const maxSources = decision.budget.maxPostSeedArtifacts + 1;
  return `最终只输出一个可被 JSON.parse 直接解析的 JSON object，不要 Markdown、代码围栏、研究过程或前后解释。真正输出必须是单行紧凑 JSON：不要缩进、不要换行、不要重复字段。契约：
{
  "id": "quote0-neuromancer-${runId}",
  "title": "优先不超过22 display units（约11个全角字），确有必要可到28 units",
  "message": "默认约80~105个中文字符；证据充足且标题较短时可扩至110~130字，优先保留3~5个互不重复的高价值已核验事实",
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
硬约束：title 的 validator 上限是32 display units，但生成目标优先控制在22以内（约11个全角字）以给正文留下最大空间，确有必要才可到28以内留安全余量（ASCII/数字约1 unit，汉字约2 units）；若 Direct Draft 的短标题在 Evidence Packet 中得到支持，优先沿用或轻改其紧凑结构，不要为了体现 Research 把标题写长。message 的物理上限随标题长度动态计算：title<=22 units 时最多280 message units（约140个全角字），较长标题最多220 units（约110个全角字）；编辑目标通常为80~105个中文字符，证据充足且短标题时可扩到110~130字。不要把物理上限误当成必须填满的字数，也不要再为了“极简”主动压回50~60字：Evidence Packet 若支持3个以上互不重复、能改变理解的高价值事实，应优先在容量内保留3~5个；只有证据本身单薄/degraded 时才合理短于70字。highlights 必须逐字出现在 message；sources 总数最多 ${maxSources}（含 seed）；claims 最多 ${maxClaims}；同一个 canonical URL 只能出现一次，禁止通过 UTM/fragment/不同 source id 把同一页面伪装成多个来源；如果 crawl 后 canonical URL 只是 seed URL 的尾斜杠/追踪参数规范化结果，两者必须合并成一个 source id，并保留更强的 source role；source.note 默认省略，只有确实需要解释来源角色/转载关系时才写且不超过80字符；不写“详情见原文”“引发关注”等空话。最终 title/message 中的每个可核验主张都必须对应 status=supported；context/unresolved/conflict 只能作为内部舍弃理由，不能留在最终可推送卡片的 claims 中。最终 message 优先保留跨来源支持、能改变理解或行动的事实、关键时间线、数字、因果/行动信息；若来源冲突或证据不足，删掉该主张或改写成可被来源支持的明确归因，禁止把争议写成定论。`;
}

/** Phase A: only collect evidence. Quote0 compacts tool outputs deterministically afterwards. */
function researchObjective(decision: ResearchTriageDecision): string {
  switch (decision.researchMode) {
    case 'digest':
      return '当前 seed 已有可用正文，但仍必须经过证据消化。快速确认 canonical/provenance/freshness，优先找能修正、补强或推翻 Direct 草稿的事实；若原文已足够，不为凑深度重复搜索。';
    case 'recovery':
      return '当前 seed 几乎没有正文证据。首要目标是找回 canonical/primary source 和真实正文，再建立可核验事实；标题只能当检索线索，不能当已证实事实包。';
    case 'verification':
      return '当前主题需要高可信核验。优先找到 primary/official source，并用至少一个独立来源交叉验证关键主张、时间状态与冲突点。';
    case 'enrichment':
      return '当前 seed 有部分事实但信息不足。只补最能提高用户理解的缺失上下文，不为“更丰富”而无边界扩搜。';
    case 'exploration':
    default:
      return '对当前主题做有边界的探索，优先寻找能改变结论或补足关键上下文的证据。';
  }
}

function minimumCoverageContract(decision: ResearchTriageDecision): string {
  if (decision.researchMode === 'recovery') {
    return `在允许 Marginal-gain stop 之前，recovery 至少完成：
- 成功恢复 1 个可读 canonical/primary 正文；
- 针对正文中最重要且可外部核验的主张，执行至少 1 次 targeted search 做独立佐证/时效检查；
- search 若命中高价值来源，至少 crawl 其中 1 个后才能把它当证据；
- seed→转载→上游原文属于同一 provenance 链，不算多个独立来源簇；产品/厂商官方文档可以验证产品能力，但不能自动当作对该厂商/作者全部论断的独立佐证。
若独立佐证客观不可获得，也必须先实际尝试，再以 degraded/unresolved 结束；不能因为已经找回正文就提前停止。`;
  }
  if (decision.researchMode === 'verification') {
    return `在允许 Marginal-gain stop 之前，verification 至少完成：
- 找到最强 primary/official source；
- 执行 targeted search，并尝试取得至少 ${decision.budget?.targetIndependentClusters ?? 2} 个 provenance 独立来源簇；
- 对金额、版本、漏洞状态、交易状态或关键时间线做 freshness/conflict check；
- search 结果必须 crawl/snapshot 后才可支持最终 claim。
同一转载链和同一利益相关方的自证不得伪装成独立 corroboration。`;
  }
  if (decision.researchMode === 'digest') {
    return `在允许 Marginal-gain stop 之前，digest 至少完成：
- seed URL 可访问时确认 canonical 正文、作者/机构与发布时间；
- **必须执行至少 1 次 freshness/provenance targeted search**，不能只 crawl seed 就宣布研究完成；
- 搜索若发现有价值的 primary/official/upstream 或独立 corroboration，必须在剩余预算内 crawl/snapshot 后才能支持最终 claim；
- 尝试取得至少 ${decision.budget?.targetIndependentClusters ?? 2} 个 provenance 独立来源簇；若客观上只有单一第一方/作者来源，必须先完成上述 targeted search 并确认没有新增独立高价值证据，才可 degraded stop；
- 任何会改变标题或最终结论的新增硬事实，必须来自已 crawl/snapshot 的证据。
即使 seed 本身就是 primary/official 且正文完整，也至少做一次定向 freshness/provenance search；随后若只有重复/低价值结果即可提前停止，不机械耗尽 4 次预算。`;
  }
  return '最低覆盖由当前 gap map 决定；一旦关键缺口已补齐且新增调用不再增加独立来源或可支持主张，即可提前停止。';
}

export function buildNeuromancerResearchPrompt(
  seed: ResearchSeed,
  decision: ResearchTriageDecision,
  runId: string,
): string {
  if (decision.lane !== 'research' || !decision.budget) {
    throw new Error('只有 research lane 才能构建 Neuromancer Research prompt');
  }
  const budget = decision.budget;
  const stageToolCalls = budget.initialToolCalls ?? budget.maxToolCalls;
  const stagedBudgetNote = budget.extensionToolCalls
    ? `\n- 这是 staged budget 的第一段：本段硬上限 ${stageToolCalls} 次；Quote0 会在本段结束后确定性检查 coverage，只有仍缺高价值独立证据时才可能额外授权 ${budget.extensionToolCalls} 次。不要预支或假定扩展一定会发生。`
    : '';
  return `你是“神经漫游者”。这是 Quote0 bounded research canary 的 Phase A：只负责检索和事实核验，不负责写最终新闻卡片。
run=${runId}；policy=${decision.policyVersion}；触发原因=${decision.reasons.join(',')}。

研究模式：${decision.researchMode || 'exploration'}
目标：${researchObjective(decision)}

研究预算：
- 本阶段最多 ${stageToolCalls} 次工具调用；达到上限立即停止。整个 Research 的绝对总上限仍为 ${budget.maxToolCalls} 次。运行时会硬执行本阶段上限，不要尝试超额调用。${stagedBudgetNote}
- **严禁并行工具调用**：每个模型轮次只允许发起 1 个工具调用，必须等待该工具结果返回后再决定下一步。
- 你必须在内部维护本阶段工具计数 1/${stageToolCalls}、2/${stageToolCalls}…；下一次调用若会超过本阶段上限，直接停止研究并输出完成标记。
- seed 之外最多形成 ${budget.maxPostSeedArtifacts} 个高价值来源制品；目标独立来源簇至少 ${budget.targetIndependentClusters} 个（若客观上不可获得则如实降级）。
- 最终 Evidence Packet 上限 ${budget.maxEvidenceChars} 字符；不要用低价值重复页面挤占证据预算。
- 不要向用户提问，不要产生 ask_user / interaction。
- 网页失败时允许 degraded；无法核验的事实不要硬补。

研究顺序（按信息增益，不是机械凑调用次数）：
1. **Canonical**：seed URL 可访问时先 crawl，确认真实正文、作者/机构、发布时间与页面内原始链接。
2. **Provenance**：追踪最强 upstream / official / primary source；搜索结果只是线索，关键来源必须 crawl 后才算证据。
3. **Gap map**：列出 seed 尚不能回答的 2~4 个关键问题，只围绕这些 gap 做 targeted search。
4. **Corroboration**：优先找独立来源验证核心主张；转载链、聚合页、同源改写不能假装成多个独立证据。
5. **Conflict + freshness**：检查金额、版本、状态、时间线是否已有更新或来源冲突；快变新闻必须优先核对最新 primary/official 状态。
6. **最低覆盖门槛**：${minimumCoverageContract(decision)}
7. **Marginal-gain stop**：只有最低覆盖门槛已满足、或已实际尝试但客观不可满足后，若连续工具调用只得到重复来源/重复主张，没有新增高价值可支持事实，才提前停止，不耗尽预算。

Seed：
${seedPayload(seed)}

Phase A 完成后不要写新闻、不要写 JSON、不要解释研究过程；只输出精确标记：${RESEARCH_PHASE_A_DONE}
即使运行时在工具调用后没有产生该标记，Quote0 也会从持久 thread 的 tool evidence 做确定性恢复。`;
}

export function buildNeuromancerResearchExtensionPrompt(
  seed: ResearchSeed,
  evidencePacket: string,
  decision: ResearchTriageDecision,
  runId: string,
  plan: { reason?: string } = {},
): string {
  const extension = decision.budget?.extensionToolCalls ?? 0;
  if (decision.researchMode !== 'digest' || extension < 1) {
    throw new Error('只有 staged digest 才能构建 Research extension prompt');
  }
  const reason = plan.reason || 'novel-evidence-candidate';
  const actionContract = reason === 'minimum-search-repair'
    ? `本次扩展是**最低覆盖修复**：第一段没有完成 mandatory freshness/provenance search。\n- 这唯一一次工具调用**必须是 targeted search**，禁止 crawl/browser。\n- 查询必须围绕 Seed 的核心实体/事件 + provenance/freshness，避免宽泛搜索；搜索结果仅作为线索，本次不把未 crawl 的结果升级成 supported evidence。`
    : reason === 'minimum-evidence-repair'
      ? `本次扩展是**最低证据修复**：第一段尚未获得任何 support-eligible crawl。\n- 这唯一一次工具调用**必须是 crawl**，禁止新的 search。\n- 优先恢复 Seed canonical/primary 页面；若同一 URL 的某引擎已失败，可换已知可用引擎重试，但不要改去无关页面。`
      : `本次扩展是**边际信息增益**：最低覆盖已满足，但仍缺一个高价值独立证据簇。\n- 这唯一一次工具调用应是 **crawl**，禁止新的 search。\n- 只从第一段 search 已发现但尚未 crawl 的候选中，选择与 Seed 核心事件真正相关、能增加独立 provenance cluster、primary/official 证据或解决冲突的最高信息增益 URL。\n- 若候选明显无关、重复、低价值或只是搜索噪声，可以不调用工具直接结束；绝不要为了“第二域”而抓取不相关页面。`;
  return `你是“神经漫游者”。这是 Quote0 bounded research run=${runId} 的 Phase A 条件扩展段。第一段已经结束；Quote0 deterministic gate 的扩展原因是 ${reason}，因此只额外授权 ${extension} 次工具调用。

这是硬预算扩展，不是重新研究：
- **只允许再调用 ${extension} 次工具**，严禁并行；不要重新执行第一段已经成功完成的动作。
- Evidence Packet 顶部 Ledger 是当前已确认可支持证据；search snippet 永远只是候选线索。
${actionContract}
- 这段仍然不写新闻、不生成最终 JSON、不向用户提问。

Seed：
${seedPayload(seed, 1000)}

已冻结 Evidence Packet：
${evidencePacket}

完成后只输出精确标记：${RESEARCH_PHASE_A_DONE}`;
}

/** Phase B: new thread, compact evidence only, and absolutely no tools. */
export function buildNeuromancerServerOwnedEditorialPrompt(
  seed: ResearchSeed,
  evidencePacket: string,
  decision: ResearchTriageDecision,
  errors: string[] = [],
  directDraft?: NeuromancerEditorialDraft,
): string {
  const errorSection = errors.length
    ? `\n此前编辑决策未通过 Quote0 deterministic gate；只修正以下问题，不新增事实：\n${errors.map((error) => `- ${error}`).join('\n')}\n`
    : '';
  return `你是“神经漫游者”的 Quote0 墨水屏编辑器。Phase A 已结束，Evidence Packet 顶部的 Ledger v2 是证据 SSoT；只有 ledger.entries 中的 E1/E2/... 可以支撑最终事实。search snippet 只用于发现线索，绝不能自行变成来源。

这一步只做编辑决策，不生成完整新闻 artifact。Quote0 服务器会自行生成 researchReceipt、sources、source、highlights、signature、category、publishTime、usage、run/thread id 与 retrieval telemetry。你禁止输出 URL、publishTime、source role、claim status 或任何 ledger 中不存在的证据。

输出语义：
- titleCandidates：恰好 3 个不同的紧凑中文标题候选，按优先级排序；保留关键实体/动作/数字，优先 <=22 display units，必要时 <=28。
- facts：1~${decision.budget?.maxPublishableClaims ?? 4} 条按信息增益排序的完整事实句。每条 text 必须是一句可以独立放进新闻卡片的完整中文句子，不写半句，不写来源列表；evidenceIds 只能引用 Ledger 中 supportEligible=true 的 E 编号。Quote0 会按真实 display units 逐句装箱，放不下的整句会被丢弃，所以最重要事实放最前。
- linkEvidenceId：选择最适合继续阅读的一个 Ledger E 编号，优先 canonical/primary/official 对应页面。

Direct Draft 只是编辑参考，不是证据；任何事实必须由 Ledger E 编号支撑：
${editorialDraftPayload(directDraft)}

Seed：
${seedPayload(seed, 1000)}

Evidence Packet：
${evidencePacket}
${errorSection}
296×152 文案 few-shot（version=${EINK_NEWS_FEW_SHOT_VERSION}；只学习信息密度和中文表达，不复制事实）：
${renderFewShots()}

不要输出 researchReceipt/source/highlights/URL/publishTime。严格服从 structured schema。`;
}

export function buildNeuromancerEvidenceFinalizationPrompt(
  seed: ResearchSeed,
  evidencePacket: string,
  runId: string,
  decision: ResearchTriageDecision,
  errors: string[] = [],
  directDraft?: NeuromancerEditorialDraft,
): string {
  const errorSection = errors.length
    ? `\n此前 finalization 未通过 Quote0 validator，只修正以下问题，不新增事实：\n${errors.map((error) => `- ${error}`).join('\n')}\n`
    : '';
  return `你是“神经漫游者”。这是 Quote0 bounded research canary 的 Phase B finalizer。Phase A 已结束；下面的 Evidence Packet 是 Quote0 从真实 tool output 确定性压缩得到的唯一证据集。researchMode=${decision.researchMode || 'exploration'}。

绝对禁止调用任何工具，禁止 search/crawl/browser，禁止向用户提问。只基于 Seed + Evidence Packet 生成最终卡片；证据不足就删掉主张或标 unresolved，不得自行补资料。
先在内部完成 claim-level 取舍：优先 primary/official + 独立 corroboration 支持的事实；同一转载链不能当多源确认；遇到冲突/过时信息要降措辞强度。最终卡片不是“研究报告摘要”，也不是“越短越好”的一句话摘要；应在真实墨水屏容量内尽可能保留最有信息增益的 3~5 条事实，尤其是关键背景、时间线、数字、因果或行动信息，同时避免重复和无效铺陈。

Direct Draft 只是编辑草稿，不是证据。可以保留它更紧凑、更具体的表达，但其中任何事实都必须能在 Seed/Evidence Packet 找到支持；若 Research 发现草稿过度断言、遗漏关键限定或事实错误，必须以证据为准修正。不要为了彰显 Research 而主动丢掉已被证据支持的高价值细节。
Direct Draft：
${editorialDraftPayload(directDraft)}

Seed（Phase B 只携带最多1000字符正文快照；完整 seed 已由 Quote0 领域存储持久化）：
${seedPayload(seed, 1000)}

Evidence Packet：
${evidencePacket}
${errorSection}
296×152 文案 few-shot（version=${EINK_NEWS_FEW_SHOT_VERSION}；只学习信息密度、长度和中文表达，不复制事实）：
${renderFewShots()}

${finalJsonContract(runId, decision)}`;
}
