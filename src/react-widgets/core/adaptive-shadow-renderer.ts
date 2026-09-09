import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RenderableDataItem } from './modular-architecture.js';
import type { RenderTarget } from './render-targets.js';
import { ADAPTIVE_LAYOUT_VERSION, planAdaptiveLayout, type AdaptiveLayoutPlan } from './adaptive-layout.js';
import { renderableNewsToAdaptiveDocument } from './adaptive-document-adapters.js';
import {
  ADAPTIVE_SATORI_RENDERER_VERSION,
  renderAdaptiveDocumentWithSatori,
  type AdaptiveSatoriRenderResult,
} from './adaptive-satori-renderer.js';
import { packFromPng } from './bitmap-packer.js';
import { getPostgresDatabase, type PostgresDatabase } from './postgres-database.js';
import type { SatoriPipelineMetrics } from './satori-renderer.js';

export const ADAPTIVE_SHADOW_VERSION = 'adaptive-render-shadow/v1';
export const PRIMARY_NEWS_RENDERER_VERSION = 'local-eink-satori-news/v1';
const DEFAULT_QUEUE_LIMIT = 32;
const MAX_QUEUE_LIMIT = 256;
const COMPLETED_KEY_CACHE_LIMIT = 2_048;

export interface AdaptiveShadowPrimaryRender {
  localImagePath?: string;
  imageUrl?: string;
  renderMetrics?: SatoriPipelineMetrics;
}

export interface AdaptiveShadowJob {
  data: RenderableDataItem;
  target: RenderTarget;
  primary: AdaptiveShadowPrimaryRender;
  deviceIds?: string[];
}

export interface MonoBitmapMetrics {
  bytes: number;
  expectedBytes: number;
  burnBits: number;
  burnRatio: number;
  bounds: null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

export interface AdaptiveShadowComparisonMetrics {
  burnBitsDelta: number;
  burnRatioDelta: number;
  shadowToPrimaryBurnRatio: number | null;
  renderMsDelta?: number;
  shadowToPrimaryRenderRatio?: number | null;
}

export interface AdaptiveShadowRecord {
  shadowKey: string;
  artifactId: string;
  contentFingerprint: string;
  subjectKey: string;
  source: string;
  targetId: string;
  widthPx: number;
  heightPx: number;
  deviceIds: string[];
  layoutEngine: string;
  shadowRenderer: string;
  primaryRenderer: string;
  state: 'completed' | 'failed';
  layoutPlan?: AdaptiveLayoutPlan;
  shadowRenderMetrics?: AdaptiveSatoriRenderResult['metrics'];
  primaryRenderMetrics?: SatoriPipelineMetrics;
  shadowBitmapMetrics?: MonoBitmapMetrics;
  primaryBitmapMetrics?: MonoBitmapMetrics;
  comparisonMetrics?: AdaptiveShadowComparisonMetrics;
  primaryImagePath?: string;
  error?: string;
}

export interface AdaptiveShadowQueueStatus {
  queueDepth: number;
  queueLimit: number;
  inFlight: boolean;
  enqueued: number;
  completed: number;
  failed: number;
  dropped: number;
  duplicatePending: number;
  duplicateCompleted: number;
  lastError: string | null;
  lastCompletedAt: string | null;
}

export interface AdaptiveShadowRuntimeStatus extends AdaptiveShadowQueueStatus {
  enabled: boolean;
  version: typeof ADAPTIVE_SHADOW_VERSION;
  layoutEngine: typeof ADAPTIVE_LAYOUT_VERSION;
  shadowRenderer: typeof ADAPTIVE_SATORI_RENDERER_VERSION;
  primaryRenderer: typeof PRIMARY_NEWS_RENDERER_VERSION;
  concurrency: 1;
  changesPhysicalDelivery: false;
}

interface ShadowDb {
  initialize(): Promise<void>;
  query(text: string, params?: any[]): Promise<any>;
}

export interface AdaptiveShadowProcessorDeps {
  database?: ShadowDb;
  readPrimaryPng?: (filePath: string) => Promise<Buffer>;
  renderShadow?: typeof renderAdaptiveDocumentWithSatori;
  packPng?: typeof packFromPng;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeLink(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function adaptiveShadowContentFingerprint(data: RenderableDataItem): string {
  return sha256(JSON.stringify({
    title: data.title.trim(),
    message: data.message.trim(),
    source: data.source.trim(),
    link: normalizeLink(data.link),
    signature: data.signature.trim(),
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
  }));
}

export function adaptiveShadowSubjectKey(data: RenderableDataItem): string {
  const link = normalizeLink(data.link);
  if (link) return `url:${link}`;
  return `title:${sha256(`${data.source.trim()}\n${data.title.trim()}`)}`;
}

export function adaptiveShadowKey(data: RenderableDataItem, target: RenderTarget): string {
  return sha256([
    ADAPTIVE_SHADOW_VERSION,
    adaptiveShadowContentFingerprint(data),
    target.id,
    `${target.widthPx}x${target.heightPx}`,
    ADAPTIVE_LAYOUT_VERSION,
    ADAPTIVE_SATORI_RENDERER_VERSION,
    PRIMARY_NEWS_RENDERER_VERSION,
  ].join('|'));
}

export function adaptiveShadowQueueLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.QUOTE0_ADAPTIVE_SHADOW_QUEUE_LIMIT ?? DEFAULT_QUEUE_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_QUEUE_LIMIT;
  return Math.min(MAX_QUEUE_LIMIT, Math.max(1, Math.round(raw)));
}

export function isAdaptiveShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QUOTE0_ADAPTIVE_SHADOW_ENABLED === 'true';
}

export function compareAdaptiveShadowMetrics(
  shadowBitmap: MonoBitmapMetrics,
  primaryBitmap: MonoBitmapMetrics,
  shadowRender: SatoriPipelineMetrics,
  primaryRender?: SatoriPipelineMetrics,
): AdaptiveShadowComparisonMetrics {
  const comparison: AdaptiveShadowComparisonMetrics = {
    burnBitsDelta: shadowBitmap.burnBits - primaryBitmap.burnBits,
    burnRatioDelta: round4(shadowBitmap.burnRatio - primaryBitmap.burnRatio),
    shadowToPrimaryBurnRatio: primaryBitmap.burnRatio > 0
      ? round4(shadowBitmap.burnRatio / primaryBitmap.burnRatio)
      : null,
  };
  if (primaryRender && Number.isFinite(primaryRender.totalMs)) {
    comparison.renderMsDelta = round4(shadowRender.totalMs - primaryRender.totalMs);
    comparison.shadowToPrimaryRenderRatio = primaryRender.totalMs > 0
      ? round4(shadowRender.totalMs / primaryRender.totalMs)
      : null;
  }
  return comparison;
}

export function measureMonoBitmap(buffer: Buffer, target: RenderTarget): MonoBitmapMetrics {
  if (target.widthPx % 8 !== 0) {
    throw new Error(`Adaptive shadow requires width divisible by 8, got ${target.widthPx}`);
  }
  const bytesPerRow = target.widthPx / 8;
  const expectedBytes = bytesPerRow * target.heightPx;
  if (buffer.length !== expectedBytes) {
    throw new Error(`Adaptive shadow bitmap size mismatch: got ${buffer.length}, expected ${expectedBytes}`);
  }

  let burnBits = 0;
  let minX = target.widthPx;
  let minY = target.heightPx;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < target.heightPx; y += 1) {
    for (let byteX = 0; byteX < bytesPerRow; byteX += 1) {
      const byte = buffer[y * bytesPerRow + byteX] ?? 0;
      if (byte === 0) continue;
      for (let bit = 0; bit < 8; bit += 1) {
        if ((byte & (1 << (7 - bit))) === 0) continue;
        const x = byteX * 8 + bit;
        burnBits += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return {
    bytes: buffer.length,
    expectedBytes,
    burnBits,
    burnRatio: round4(burnBits / (target.widthPx * target.heightPx)),
    bounds: maxX < 0 ? null : {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}

async function persistShadowRecord(database: ShadowDb, record: AdaptiveShadowRecord): Promise<void> {
  await database.initialize();
  await database.query(
    `INSERT INTO adaptive_render_shadow_runs (
       shadow_key, artifact_id, content_fingerprint, subject_key, source,
       target_id, width_px, height_px, device_ids,
       layout_engine, shadow_renderer, primary_renderer, state,
       layout_plan, shadow_render_metrics, primary_render_metrics,
       shadow_bitmap_metrics, primary_bitmap_metrics, comparison_metrics,
       primary_image_path, error
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,
       $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21
     )
     ON CONFLICT (shadow_key) DO NOTHING`,
    [
      record.shadowKey,
      record.artifactId,
      record.contentFingerprint,
      record.subjectKey,
      record.source,
      record.targetId,
      record.widthPx,
      record.heightPx,
      JSON.stringify(record.deviceIds),
      record.layoutEngine,
      record.shadowRenderer,
      record.primaryRenderer,
      record.state,
      record.layoutPlan ? JSON.stringify(record.layoutPlan) : null,
      record.shadowRenderMetrics ? JSON.stringify(record.shadowRenderMetrics) : null,
      record.primaryRenderMetrics ? JSON.stringify(record.primaryRenderMetrics) : null,
      record.shadowBitmapMetrics ? JSON.stringify(record.shadowBitmapMetrics) : null,
      record.primaryBitmapMetrics ? JSON.stringify(record.primaryBitmapMetrics) : null,
      record.comparisonMetrics ? JSON.stringify(record.comparisonMetrics) : null,
      record.primaryImagePath ?? null,
      record.error ?? null,
    ],
  );
}

function baseRecord(job: AdaptiveShadowJob): Omit<AdaptiveShadowRecord, 'state'> {
  return {
    shadowKey: adaptiveShadowKey(job.data, job.target),
    artifactId: String(job.data.id),
    contentFingerprint: adaptiveShadowContentFingerprint(job.data),
    subjectKey: adaptiveShadowSubjectKey(job.data),
    source: job.data.source,
    targetId: job.target.id,
    widthPx: job.target.widthPx,
    heightPx: job.target.heightPx,
    deviceIds: [...new Set(job.deviceIds ?? [])],
    layoutEngine: ADAPTIVE_LAYOUT_VERSION,
    shadowRenderer: ADAPTIVE_SATORI_RENDERER_VERSION,
    primaryRenderer: PRIMARY_NEWS_RENDERER_VERSION,
    ...(job.primary.renderMetrics ? { primaryRenderMetrics: job.primary.renderMetrics } : {}),
    ...(job.primary.localImagePath ? { primaryImagePath: job.primary.localImagePath } : {}),
  };
}

export async function executeAdaptiveRenderShadow(
  job: AdaptiveShadowJob,
  deps: AdaptiveShadowProcessorDeps = {},
): Promise<AdaptiveShadowRecord> {
  const database = deps.database ?? getPostgresDatabase();
  const renderShadow = deps.renderShadow ?? renderAdaptiveDocumentWithSatori;
  const packPng = deps.packPng ?? packFromPng;
  const readPrimaryPng = deps.readPrimaryPng ?? ((filePath: string) => readFile(path.resolve(filePath)));
  const base = baseRecord(job);
  let layoutPlan: AdaptiveLayoutPlan | undefined;

  try {
    if (!job.primary.localImagePath) {
      throw new Error('Adaptive shadow requires the actual primary local PNG for A/B metrics');
    }
    const document = renderableNewsToAdaptiveDocument(job.data);
    layoutPlan = planAdaptiveLayout(document, job.target);
    const [shadow, primaryPng] = await Promise.all([
      renderShadow(document, job.target, layoutPlan),
      readPrimaryPng(job.primary.localImagePath),
    ]);
    const [shadowBitmap, primaryBitmap] = await Promise.all([
      packPng(shadow.pngBuffer, job.target),
      packPng(primaryPng, job.target),
    ]);
    const shadowBitmapMetrics = measureMonoBitmap(shadowBitmap, job.target);
    const primaryBitmapMetrics = measureMonoBitmap(primaryBitmap, job.target);
    const record: AdaptiveShadowRecord = {
      ...base,
      state: 'completed',
      layoutPlan,
      shadowRenderMetrics: shadow.metrics,
      shadowBitmapMetrics,
      primaryBitmapMetrics,
      comparisonMetrics: compareAdaptiveShadowMetrics(
        shadowBitmapMetrics,
        primaryBitmapMetrics,
        shadow.metrics,
        job.primary.renderMetrics,
      ),
    };
    await persistShadowRecord(database, record);
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record: AdaptiveShadowRecord = {
      ...base,
      state: 'failed',
      ...(layoutPlan ? { layoutPlan } : {}),
      error: message,
    };
    try {
      await persistShadowRecord(database, record);
    } catch (persistError) {
      const persistMessage = persistError instanceof Error ? persistError.message : String(persistError);
      throw new Error(`${message}; shadow evidence persist failed: ${persistMessage}`);
    }
    return record;
  }
}

export class AdaptiveShadowQueue {
  private readonly jobs: AdaptiveShadowJob[] = [];
  private readonly pendingKeys = new Set<string>();
  private readonly completedKeys = new Set<string>();
  private readonly completedKeyOrder: string[] = [];
  private inFlight = false;
  private enqueued = 0;
  private completed = 0;
  private failed = 0;
  private dropped = 0;
  private duplicatePending = 0;
  private duplicateCompleted = 0;
  private lastError: string | null = null;
  private lastCompletedAt: string | null = null;

  constructor(
    private readonly processor: (job: AdaptiveShadowJob) => Promise<AdaptiveShadowRecord>,
    private readonly queueLimit: number,
  ) {}

  enqueue(job: AdaptiveShadowJob): 'queued' | 'duplicate' | 'dropped' {
    const key = adaptiveShadowKey(job.data, job.target);
    if (this.pendingKeys.has(key)) {
      this.duplicatePending += 1;
      return 'duplicate';
    }
    if (this.completedKeys.has(key)) {
      this.duplicateCompleted += 1;
      return 'duplicate';
    }
    if (this.jobs.length >= this.queueLimit) {
      this.dropped += 1;
      return 'dropped';
    }
    this.pendingKeys.add(key);
    this.jobs.push(job);
    this.enqueued += 1;
    // Use a macrotask, not a microtask: the production caller's Promise continuation
    // (frame cache / device push) must get a chance to run before shadow CPU work begins.
    setImmediate(() => void this.drain());
    return 'queued';
  }

  status(): AdaptiveShadowQueueStatus {
    return {
      queueDepth: this.jobs.length,
      queueLimit: this.queueLimit,
      inFlight: this.inFlight,
      enqueued: this.enqueued,
      completed: this.completed,
      failed: this.failed,
      dropped: this.dropped,
      duplicatePending: this.duplicatePending,
      duplicateCompleted: this.duplicateCompleted,
      lastError: this.lastError,
      lastCompletedAt: this.lastCompletedAt,
    };
  }

  async drain(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!;
        const key = adaptiveShadowKey(job.data, job.target);
        try {
          const result = await this.processor(job);
          if (result.state === 'completed') {
            this.completed += 1;
            this.rememberCompletedKey(key);
            this.lastCompletedAt = new Date().toISOString();
          } else {
            this.failed += 1;
            this.lastError = result.error ?? 'adaptive shadow failed';
          }
        } catch (error) {
          this.failed += 1;
          this.lastError = error instanceof Error ? error.message : String(error);
        } finally {
          this.pendingKeys.delete(key);
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  private rememberCompletedKey(key: string): void {
    if (this.completedKeys.has(key)) return;
    this.completedKeys.add(key);
    this.completedKeyOrder.push(key);
    while (this.completedKeyOrder.length > COMPLETED_KEY_CACHE_LIMIT) {
      const evicted = this.completedKeyOrder.shift();
      if (evicted) this.completedKeys.delete(evicted);
    }
  }
}

const adaptiveShadowQueue = new AdaptiveShadowQueue(
  (job) => executeAdaptiveRenderShadow(job),
  adaptiveShadowQueueLimit(),
);

export function enqueueAdaptiveRenderShadow(job: AdaptiveShadowJob): 'disabled' | 'queued' | 'duplicate' | 'dropped' {
  if (!isAdaptiveShadowEnabled()) return 'disabled';
  return adaptiveShadowQueue.enqueue(job);
}

export function getAdaptiveShadowRuntimeStatus(): AdaptiveShadowRuntimeStatus {
  return {
    enabled: isAdaptiveShadowEnabled(),
    version: ADAPTIVE_SHADOW_VERSION,
    layoutEngine: ADAPTIVE_LAYOUT_VERSION,
    shadowRenderer: ADAPTIVE_SATORI_RENDERER_VERSION,
    primaryRenderer: PRIMARY_NEWS_RENDERER_VERSION,
    concurrency: 1,
    changesPhysicalDelivery: false,
    ...adaptiveShadowQueue.status(),
  };
}

export async function listRecentAdaptiveShadowRuns(limit = 20, database: ShadowDb = getPostgresDatabase()): Promise<any[]> {
  const bounded = Math.min(100, Math.max(1, Math.round(limit)));
  await database.initialize();
  const result = await database.query(
    `SELECT id, shadow_key, artifact_id, content_fingerprint, subject_key, source,
            target_id, width_px, height_px, device_ids,
            layout_engine, shadow_renderer, primary_renderer, state,
            layout_plan, shadow_render_metrics, primary_render_metrics,
            shadow_bitmap_metrics, primary_bitmap_metrics, comparison_metrics,
            primary_image_path, error, created_at
       FROM adaptive_render_shadow_runs
      ORDER BY created_at DESC
      LIMIT $1`,
    [bounded],
  );
  return result.rows;
}

// Keep the imported concrete type reachable for API consumers without exposing Pool internals.
export type AdaptiveShadowDatabase = Pick<PostgresDatabase, 'initialize' | 'query'>;
