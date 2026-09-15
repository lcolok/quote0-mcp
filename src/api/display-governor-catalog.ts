import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Candidate } from './display-governor.js';
import { MINUTE, validateCandidate } from './display-governor.js';
import { RESEARCH_REPLAY_COMPATIBLE_POLICY_VERSIONS } from './research-triage.js';
import type { WeatherData } from '../react-widgets/types.js';

export interface InventoryRow {
  id: number;
  fingerprint: string | null;
  source: string | null;
  title: string | null;
  link: string | null;
  raw_content: Record<string, unknown> | null;
  processed_content: Record<string, unknown> | null;
  created_ms: string | number;
  expires_ms: string | number;
}
export interface PeriodicPayload {
  kind: 'weather' | 'memo';
  weather?: WeatherData;
  memoId?: string;
  pngRef?: string;
  pngHash?: string;
}
export interface CatalogEntry { candidate: Candidate; payload: PeriodicPayload; observedAtMs: number }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Preserve the existing quality + compatible Research gates and 24h expiry. No six-hour tier. */
export const GOVERNOR_NEWS_ADMISSION = `ci.state IN ('ready','pushed')
  AND ci.created_at > LOCALTIMESTAMP - INTERVAL '24 hours'
  AND (ci.expires_at IS NULL OR ci.expires_at > LOCALTIMESTAMP)
  AND COALESCE(ci.processed_content->'metadata'->'contentQuality'->>'disposition','deliver') <> 'hold'
  AND (COALESCE(ci.processed_content->'metadata'->'researchGate'->>'required','false') <> 'true'
    OR (ci.processed_content->'metadata'->'researchGate'->>'state' = 'ready'
      AND ci.processed_content->'metadata'->'researchGate'->>'researchPolicyVersion' = ANY($1::text[])))`;
const INVENTORY_PROJECTION = `ci.*,
  floor(extract(epoch FROM (ci.created_at AT TIME ZONE current_setting('TimeZone')))*1000)::bigint AS created_ms,
  floor(extract(epoch FROM (LEAST(ci.created_at + INTERVAL '24 hours',
    COALESCE(ci.expires_at,ci.created_at + INTERVAL '24 hours')) AT TIME ZONE current_setting('TimeZone')))*1000)::bigint AS expires_ms`;

/** Snapshot digest fences editing/materialization during render; it is NOT a semantic novelty claim. */
export function inventoryCandidate(row: InventoryRow): Candidate {
  const key = `news:${row.fingerprint || row.id}`;
  const digest = hash([row.processed_content, row.raw_content, row.title, row.source, row.link]);
  const candidate: Candidate = {
    key, exposureKey: key, source: row.source || 'unknown', version: 'article-v1', kind: 'news',
    eligibleFromMs: Number(row.created_ms), expiresAtMs: Number(row.expires_ms), admitted: true,
    dataRef: `inventory:${row.id}:${digest}`,
  };
  validateCandidate(candidate);
  return candidate;
}

/** AMAP timestamps are CST wall time. Never interpret them in the API host's local timezone. */
export function parseAmapObservationTime(text: string | undefined): number {
  if (!text) throw new Error('Weather observation time missing; fetch time cannot renew TTL');
  const value = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}+08:00` : text;
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Weather observation time needs a timezone');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  const ms = Date.parse(value);
  if (!parts || !Number.isFinite(ms) || ms < 0) throw new Error('Invalid weather observation time');
  const [, y, m, d, h, minute, second] = parts.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
      h > 23 || minute > 59 || second > 59) throw new Error('Invalid weather observation calendar date');
  return ms;
}

export function weatherCatalogEntry(jobId: string, data: WeatherData, nowMs: number): CatalogEntry {
  if (!data.city?.trim() || !data.weather?.trim() ||
      !Number.isFinite(data.temperature) || !Number.isFinite(data.humidity)) throw new Error('Invalid weather observations');
  const observedAtMs = parseAmapObservationTime(data.updateTime || data.lastUpdate);
  if (observedAtMs > nowMs + MINUTE) throw new Error('Weather observation is in the future');
  const expiresAtMs = observedAtMs + 120 * MINUTE;
  if (expiresAtMs <= nowMs) throw new Error('Weather observation expired');
  // A fetch/timestamp/PNG does not create a new semantic version of otherwise unchanged weather.
  const version = hash([data.city, data.temperature, data.weather, data.humidity,
    data.windDirection, data.windPower, data.aqi, data.forecast]);
  const key = `weather:${jobId}`;
  const payload: PeriodicPayload = { kind: 'weather', weather: structuredClone(data) };
  const candidate: Candidate = { key, exposureKey: key, source: `weather:amap:${data.city}`,
    version, kind: 'weather', admitted: true, eligibleFromMs: Math.max(nowMs, observedAtMs),
    expiresAtMs, dataRef: `catalog:${key}:${hash(payload)}` };
  validateCandidate(candidate);
  return { candidate, payload, observedAtMs };
}

export function memoCatalogEntry(jobId: string, memoId: string, pngRef: string, pngHash: string,
  nowMs: number): CatalogEntry {
  if (!/^[a-f0-9]{64}$/.test(pngHash)) throw new Error('Invalid memo payload hash');
  const key = `memo:${memoId}`;
  const candidate: Candidate = { key, exposureKey: key, source: `memo:${jobId}`, version: pngHash,
    kind: 'memo', admitted: true, eligibleFromMs: nowMs, expiresAtMs: nowMs + 24 * 60 * MINUTE,
    dataRef: `catalog:${key}:${pngHash}` };
  validateCandidate(candidate);
  return { candidate, payload: { kind: 'memo', memoId, pngRef, pngHash }, observedAtMs: nowMs };
}

export async function savePeriodicCandidate(pool: Pool, jobId: string, entry: CatalogEntry): Promise<void> {
  validateCandidate(entry.candidate);
  await pool.query(
    `INSERT INTO display_governor_candidates(candidate_key,producer_job_id,candidate,payload,observed_at,expires_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,to_timestamp($5/1000.0),to_timestamp($6/1000.0))
     ON CONFLICT(candidate_key) DO UPDATE SET producer_job_id=EXCLUDED.producer_job_id,
       candidate=EXCLUDED.candidate,payload=EXCLUDED.payload,observed_at=EXCLUDED.observed_at,
       expires_at=EXCLUDED.expires_at,updated_at=now()
     WHERE EXCLUDED.observed_at >= display_governor_candidates.observed_at`,
    [entry.candidate.key, jobId, JSON.stringify(entry.candidate), JSON.stringify(entry.payload),
      entry.observedAtMs, entry.candidate.expiresAtMs]);
}

const PERIODIC_ADMISSION = `gc.expires_at > now() AND j.enabled=true
  AND ((gc.candidate->>'kind'='weather' AND j.data_source='weather' AND j.renderer='local-eink')
    OR (gc.candidate->>'kind'='memo' AND j.data_source='memo' AND EXISTS (
      SELECT 1 FROM memos m WHERE m.id::text=gc.payload->>'memoId'
        AND m.enabled=true AND m.status='ready' AND COALESCE(m.target_renderer,'both') IN ('local-eink','both')
    )))`;

export async function listGovernorCandidates(pool: Pool): Promise<Candidate[]> {
  const news = await pool.query<InventoryRow>(
    `SELECT ${INVENTORY_PROJECTION} FROM content_inventory ci WHERE ${GOVERNOR_NEWS_ADMISSION}
     ORDER BY ci.created_at ASC LIMIT 501`, [[...RESEARCH_REPLAY_COMPATIBLE_POLICY_VERSIONS]]);
  const periodic = await pool.query<{ candidate: Candidate }>(
    `SELECT gc.candidate FROM display_governor_candidates gc
     JOIN news_scheduler_jobs j ON j.id=gc.producer_job_id WHERE ${PERIODIC_ADMISSION} LIMIT 501`);
  if (news.rows.length > 500 || periodic.rows.length > 500) throw new Error('Governor catalog capacity exceeded');
  const candidates = [...news.rows.map(inventoryCandidate), ...periodic.rows.map(row => row.candidate)];
  candidates.forEach(validateCandidate);
  return candidates;
}

/** Also used under the publication transaction; lock gates so revocation cannot race publication. */
export async function loadAdmittedInventory(client: Pool | PoolClient, candidate: Candidate,
  lock = false): Promise<InventoryRow | null> {
  const id = Number(candidate.dataRef.split(':')[1]);
  if (candidate.kind !== 'news' || !Number.isSafeInteger(id) || id <= 0) return null;
  const result = await client.query<InventoryRow>(
    `SELECT ${INVENTORY_PROJECTION} FROM content_inventory ci
      WHERE ${GOVERNOR_NEWS_ADMISSION} AND ci.id=$2 ${lock ? 'FOR SHARE OF ci' : ''}`,
    [[...RESEARCH_REPLAY_COMPATIBLE_POLICY_VERSIONS], id]);
  const row = result.rows[0];
  return row && inventoryCandidate(row).dataRef === candidate.dataRef ? row : null;
}

export async function loadAdmittedPeriodic(client: Pool | PoolClient, candidate: Candidate,
  lock = false): Promise<PeriodicPayload | null> {
  if (candidate.kind === 'memo') {
    const result = await client.query<{ candidate: Candidate; payload: PeriodicPayload }>(
      `SELECT gc.candidate,gc.payload FROM display_governor_candidates gc
       JOIN news_scheduler_jobs j ON j.id=gc.producer_job_id
       JOIN memos m ON m.id::text=gc.payload->>'memoId'
       WHERE gc.candidate_key=$1 AND gc.expires_at > now() AND j.enabled=true
         AND j.data_source='memo' AND m.enabled=true AND m.status='ready'
         AND COALESCE(m.target_renderer,'both') IN ('local-eink','both')
       ${lock ? 'FOR SHARE OF gc,j,m' : ''}`,
      [candidate.key]);
    const row = result.rows[0];
    return row?.candidate.dataRef === candidate.dataRef ? row.payload : null;
  }

  if (candidate.kind !== 'weather') return null;
  const result = await client.query<{ candidate: Candidate; payload: PeriodicPayload }>(
    `SELECT gc.candidate,gc.payload FROM display_governor_candidates gc
     JOIN news_scheduler_jobs j ON j.id=gc.producer_job_id
     WHERE gc.candidate_key=$1 AND gc.expires_at > now() AND j.enabled=true
       AND j.data_source='weather' AND j.renderer='local-eink'
     ${lock ? 'FOR SHARE OF gc,j' : ''}`,
    [candidate.key]);
  const row = result.rows[0];
  return row?.candidate.dataRef === candidate.dataRef ? row.payload : null;
}

export async function candidateStillAdmitted(client: PoolClient, candidate: Candidate): Promise<boolean> {
  return candidate.kind === 'news' ? Boolean(await loadAdmittedInventory(client, candidate, true))
    : Boolean(await loadAdmittedPeriodic(client, candidate, true));
}
