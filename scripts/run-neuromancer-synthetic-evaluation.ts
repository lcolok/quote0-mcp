import {
  buildSyntheticJudgePrompt,
  listSyntheticEvaluations,
  loadSyntheticEvaluationSubjects,
  parseSyntheticJudgeResult,
  saveSyntheticEvaluation,
  aggregateSyntheticEvaluations,
  type SyntheticEvaluationSubject,
} from '../src/api/neuromancer-synthetic-evaluation-service.js';
import {
  assessSyntheticPromotionGate,
  promoteNeuromancerArtifact,
} from '../src/api/neuromancer-promotion-service.js';
import { getPostgresDatabase } from '../src/react-widgets/core/postgres-database.js';

interface Args {
  providers: string[];
  runIds: string[];
  limit: number;
  concurrency: number;
  timeoutMs: number;
  apply: boolean;
  promote: 'none' | 'best' | 'eligible';
  enqueue: 'none' | 'best';
  approvedBy: string;
  force: boolean;
}

interface StraylightJob {
  jobId: string;
  threadId: string;
  status?: string;
  response?: unknown;
  error?: string;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function listArg(value: string | undefined): string[] {
  return [...new Set((value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseArgs(): Args {
  const providers = listArg(argValue('providers'));
  const promoteRaw = argValue('promote') || 'none';
  const enqueueRaw = argValue('enqueue') || 'none';
  if (!['none', 'best', 'eligible'].includes(promoteRaw)) throw new Error('--promote 必须是 none|best|eligible');
  if (!['none', 'best'].includes(enqueueRaw)) throw new Error('--enqueue 必须是 none|best');
  return {
    providers: providers.length ? providers : ['hy3', 'deepseek-v4-pro'],
    runIds: listArg(argValue('run-ids')),
    limit: boundedInt(argValue('limit'), 50, 1, 100),
    concurrency: boundedInt(argValue('concurrency'), 4, 1, 12),
    timeoutMs: boundedInt(argValue('timeout-ms'), 180_000, 10_000, 300_000),
    apply: hasFlag('apply'),
    promote: promoteRaw as Args['promote'],
    enqueue: enqueueRaw as Args['enqueue'],
    approvedBy: (argValue('approved-by') || '').trim(),
    force: hasFlag('force'),
  };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function baseUrl(): string {
  const raw = cleanString(process.env.STRAYLIGHT_RESEARCH_BASE_URL);
  if (!raw) throw new Error('STRAYLIGHT_RESEARCH_BASE_URL 未配置');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('STRAYLIGHT_RESEARCH_BASE_URL 必须是 http/https');
  return parsed.toString().replace(/\/$/u, '');
}

function authHeaders(): Record<string, string> {
  const token = cleanString(process.env.STRAYLIGHT_RESEARCH_BEARER_TOKEN);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function requestJson(path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    throw new Error(`Straylight ${path} HTTP ${response.status}: ${isRecord(data) ? data.error || data.message : data}`);
  }
  return data;
}

function latestCompletedThreadText(snapshot: unknown): string {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.turns)) return '';
  for (let turnIndex = snapshot.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = snapshot.turns[turnIndex];
    if (!isRecord(turn) || turn.participantType !== 'agent' || turn.state !== 'completed' || !Array.isArray(turn.blocks)) continue;
    for (let blockIndex = turn.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = turn.blocks[blockIndex];
      if (isRecord(block) && block.type === 'text' && cleanString(block.text)) return cleanString(block.text);
    }
  }
  return '';
}

async function dispatchJudge(
  subject: SyntheticEvaluationSubject,
  providerId: string,
  attempt: number,
): Promise<{ jobId: string; threadId: string; prompt: ReturnType<typeof buildSyntheticJudgePrompt> }> {
  const judgeId = providerId;
  const prompt = buildSyntheticJudgePrompt(subject, judgeId);
  const payload = await requestJson('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      message: prompt.prompt,
      agentId: cleanString(process.env.STRAYLIGHT_RESEARCH_AGENT_ID) || 'pi-mono',
      providerId,
      source: {
        channel: 'agent',
        identity: `quote0-synthetic-eval:${subject.runId}:${providerId}:a${attempt}`,
      },
    }),
  });
  const jobId = cleanString(payload?.jobId);
  const threadId = cleanString(payload?.threadId);
  if (!jobId || !threadId) throw new Error('Straylight /jobs 缺少 jobId/threadId');
  return { jobId, threadId, prompt };
}

async function waitJudge(jobId: string, threadId: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const job = await requestJson(`/jobs/${encodeURIComponent(jobId)}`) as StraylightJob;
    lastStatus = cleanString(job.status);
    if (lastStatus === 'error') throw new Error(cleanString(job.error) || 'synthetic judge job error');
    if (lastStatus === 'completed') {
      if (cleanString(job.response)) return job.response;
      const thread = await requestJson(`/threads/${encodeURIComponent(threadId)}`);
      const text = latestCompletedThreadText(thread);
      if (text) return text;
      throw new Error('synthetic judge completed 但无 assistant JSON');
    }
    await Bun.sleep(1_500);
  }
  throw new Error(`synthetic judge timeout: status=${lastStatus || 'unknown'}`);
}

async function evaluateOne(
  subject: SyntheticEvaluationSubject,
  providerId: string,
  timeoutMs: number,
): Promise<{ providerId: string; saved: boolean; evaluation?: any; error?: string }> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const dispatched = await dispatchJudge(subject, providerId, attempt);
      const raw = await waitJudge(dispatched.jobId, dispatched.threadId, timeoutMs);
      const parsed = parseSyntheticJudgeResult(raw);
      const rawObject = typeof raw === 'string' ? JSON.parse(raw.trim()) : raw as Record<string, unknown>;
      const saved = await saveSyntheticEvaluation(getPostgresDatabase(), {
        subject,
        judgeId: providerId,
        providerId,
        blindResult: parsed,
        researchSide: dispatched.prompt.researchSide,
        rawResult: rawObject,
        evidenceDigest: dispatched.prompt.evidenceDigest,
        straylightJobId: dispatched.jobId,
        straylightThreadId: dispatched.threadId,
      });
      return { providerId, saved: true, evaluation: saved };
    } catch (error) {
      if (attempt === 2) {
        return { providerId, saved: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  return { providerId, saved: false, error: 'unreachable' };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return output;
}

function liftScore(aggregate: ReturnType<typeof aggregateSyntheticEvaluations>): number {
  return aggregate.scoreDelta.factualConfidence
    + aggregate.scoreDelta.informationDensity
    + aggregate.scoreDelta.einkSuitability
    + aggregate.meanConfidence;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.apply && args.promote !== 'none' && !args.approvedBy) {
    throw new Error('--apply promotion 必须显式提供 --approved-by；synthetic judge 不能自行批准');
  }

  const db = getPostgresDatabase();
  await db.initialize();
  const subjects = await loadSyntheticEvaluationSubjects(db, { runIds: args.runIds, limit: args.limit });
  if (!subjects.length) throw new Error('没有可评估的 completed Direct/Research pair');

  const tasks: Array<{ subject: SyntheticEvaluationSubject; providerId: string }> = [];
  for (const subject of subjects) {
    const existing = await listSyntheticEvaluations(db, subject.runId);
    for (const providerId of args.providers) {
      const current = existing.find((evaluation) => evaluation.judgeId === providerId);
      const currentDigest = buildSyntheticJudgePrompt(subject, providerId).evidenceDigest;
      if (!args.force && current?.evidenceDigest === currentDigest) continue;
      tasks.push({ subject, providerId });
    }
  }

  const execution = await mapConcurrent(tasks, args.concurrency, async ({ subject, providerId }) => ({
    runId: subject.runId,
    subjectTitle: cleanString(subject.seed.title),
    ...(await evaluateOne(subject, providerId, args.timeoutMs)),
  }));

  const reports = [];
  for (const subject of subjects) {
    const evaluations = await listSyntheticEvaluations(db, subject.runId);
    const aggregate = aggregateSyntheticEvaluations(evaluations);
    const gate = assessSyntheticPromotionGate(subject, evaluations);
    reports.push({
      runId: subject.runId,
      sourceInventoryId: subject.sourceInventoryId,
      subjectTitle: cleanString(subject.seed.title),
      directTitle: cleanString(subject.direct.title),
      researchTitle: cleanString(subject.research.title),
      humanChoice: subject.humanChoice,
      aggregate,
      gate,
      liftScore: liftScore(aggregate),
    });
  }

  const eligible = reports.filter((report) => report.gate.eligible).sort((a, b) => b.liftScore - a.liftScore);
  const selected = args.promote === 'best'
    ? eligible.slice(0, 1)
    : args.promote === 'eligible'
      ? eligible
      : [];
  const enqueueRunId = args.enqueue === 'best' ? eligible[0]?.runId : undefined;
  const promotions = [];
  if (args.apply) {
    for (const report of selected) {
      promotions.push(await promoteNeuromancerArtifact(db, {
        runId: report.runId,
        approvedBy: args.approvedBy,
        enqueueNow: report.runId === enqueueRunId,
      }));
    }
  }

  const researchWins = reports.filter((report) => report.aggregate.votes.research > report.aggregate.votes.direct).length;
  const directWins = reports.filter((report) => report.aggregate.votes.direct > report.aggregate.votes.research).length;
  const ties = reports.length - researchWins - directWins;
  const meanDelta = (key: 'factualConfidence' | 'informationDensity' | 'einkSuitability') =>
    reports.reduce((sum, report) => sum + report.aggregate.scoreDelta[key], 0) / reports.length;

  console.log(JSON.stringify({
    schemaVersion: 'quote0-synthetic-evaluation-run/v1',
    syntheticNotHuman: true,
    args: {
      providers: args.providers,
      limit: args.limit,
      concurrency: args.concurrency,
      apply: args.apply,
      promote: args.promote,
      enqueue: args.enqueue,
      approvedBy: args.approvedBy || null,
    },
    evaluatedSubjects: subjects.length,
    newJudgeExecutions: execution,
    summary: {
      researchWins,
      directWins,
      ties,
      eligiblePromotions: eligible.length,
      meanScoreDeltaResearchMinusDirect: {
        factualConfidence: meanDelta('factualConfidence'),
        informationDensity: meanDelta('informationDensity'),
        einkSuitability: meanDelta('einkSuitability'),
      },
    },
    reports,
    promotions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
