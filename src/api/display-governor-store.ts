import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { crc32Hex } from './eink-converter.js';
import { acknowledge, authorizedFrame, initialState, pruneExposureHistory, publish, reserve,
  type Candidate, type Policy, type State, type Transition } from './display-governor.js';
import type { DisplayAckPayload } from './eink-pull-protocol.js';
import { displayOwnershipLockKey, displayEndpointLockKey } from './display-governor-ownership.js';
import { configuredGovernorDevices } from './display-governor-config.js';

export interface GovernorRow {
  device_id: string;
  state: State;
  frame_id: string | null;
  frame_crc32: string | null;
  now_ms: string | number;
}
export interface PreparedBitmap { bitmap: Buffer; width: number; height: number }
export type AdmissionGuard = (client: PoolClient, candidate: Candidate) => Promise<boolean>;

/**
 * A row lock serializes every decision/ACK for one device across all API processes.
 * Publication commits state + exact pull bytes + audit + transactional NOTIFY together.
 * The frame row is the durable latest-value outbox: lost NOTIFY is repaired by GET polling.
 */
export class DisplayGovernorStore {
  constructor(readonly pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  private async locked(client: PoolClient, deviceId: string): Promise<GovernorRow | null> {
    const result = await client.query<GovernorRow>(
      `SELECT device_id, state, frame_id, frame_crc32,
              floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
         FROM display_governor_states WHERE device_id=$1 FOR UPDATE`, [deviceId]);
    const row = result.rows[0] ?? null;
    if (row && (row.state.schema !== 'quote0-display-governor/v1' || row.state.deviceId !== deviceId)) {
      throw new Error('Corrupt display governor state');
    }
    return row;
  }

  private async event(client: PoolClient, state: State, event: string, details: unknown): Promise<void> {
    await client.query(
      `INSERT INTO display_governor_events(device_id,generation,event,details)
       VALUES ($1,$2,$3,$4::jsonb)`, [state.deviceId, state.generation, event, JSON.stringify(details)]);
  }

  /** Ownership persists across env removal. Removing an allowlist entry PAUSES, not a live rollback. */
  async enroll(deviceId: string, drainMs = 180_000): Promise<void> {
    if (!Number.isSafeInteger(drainMs) || drainMs < 0) throw new Error('Invalid drain interval');
    await this.transaction(async client => {
      const device = await client.query<{ base_url: string }>('SELECT base_url FROM push_devices WHERE id=$1 FOR SHARE', [deviceId]);
      if (!device.rows[0]) throw new Error('Cannot enroll an unregistered display device');
      const endpointKey = displayEndpointLockKey(device.rows[0].base_url);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [endpointKey]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [displayOwnershipLockKey(deviceId)]);
      const aliases = await client.query<{ base_url: string }>(
        'SELECT p.base_url FROM push_devices p JOIN display_governor_states g ON g.device_id=p.id WHERE p.id <> $1', [deviceId]);
      if (aliases.rows.some(row => displayEndpointLockKey(row.base_url) === endpointKey)) {
        throw new Error('Another governed device owns the same physical endpoint');
      }
      const time = await client.query<{ now_ms: string }>(
        'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms');
      const now = Number(time.rows[0].now_ms);
      const state = initialState(deviceId);
      state.lastClockMs = now;
      state.uncertainProtectedUntilMs = now + drainMs;
      const inserted = await client.query(
        `INSERT INTO display_governor_states(device_id,state,last_decision)
         VALUES ($1,$2::jsonb,$3::jsonb) ON CONFLICT DO NOTHING RETURNING device_id`,
        [deviceId, JSON.stringify(state), JSON.stringify({ reason: 'cutover-drain', untilMs: now + drainMs })]);
      if (inserted.rowCount) await this.event(client, state, 'enrolled', { drainMs, transport: 'pull-v2' });
      // Do not touch leased work: a live old sender may be finishing. The runtime waits for it.
      await client.query(
        `UPDATE device_deliveries SET state='superseded', finished_at=now(), updated_at=now(),
                last_error_code='superseded', last_error='display governor owns device'
          WHERE device_id=$1 AND state IN ('queued','retry_wait') AND lease_owner IS NULL`, [deviceId]);
    });
  }

  /**
   * Explicit rollback primitive. It is intentionally NOT tied to env removal: first deploy
   * with the device removed from QUOTE0_DISPLAY_GOVERNOR_DEVICES, then invoke release.
   * The latest approved frame is retained so the panel never blanks; legacy writers may
   * replace it after ownership is released.
   */
  async release(deviceId: string): Promise<boolean> {
    if (configuredGovernorDevices().includes(deviceId)) {
      throw new Error('Refusing release while device remains configured for display governor');
    }
    return this.transaction(async client => {
      const device = await client.query<{ base_url: string }>(
        'SELECT base_url FROM push_devices WHERE id=$1 FOR SHARE', [deviceId]);
      if (!device.rows[0]) throw new Error('Cannot release an unregistered display device');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [displayEndpointLockKey(device.rows[0].base_url)]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [displayOwnershipLockKey(deviceId)]);
      const row = await this.locked(client, deviceId);
      if (!row) return false;
      if (row.state.pending) throw new Error('Refusing release with an in-flight governor publication');
      const activeLegacy = await client.query(
        `SELECT 1 FROM device_deliveries WHERE device_id=$1 AND state='leased'
          AND lease_expires_at > now() LIMIT 1`, [deviceId]);
      if (activeLegacy.rowCount) throw new Error('Refusing release while a legacy delivery is in flight');
      await this.event(client, row.state, 'released', {
        currentCandidateKey: row.state.current?.candidate.key ?? null,
        currentFrameId: row.frame_id,
      });
      await client.query('DELETE FROM display_governor_states WHERE device_id=$1', [deviceId]);
      return true;
    });
  }

  /**
   * Seed cooldown/source history from the legacy per-device delivery ledger at cutover.
   * Legacy `succeeded` is weaker evidence than the new panel-refresh ACK, but treating it
   * conservatively as "already seen" prevents a 24h cold-start replay wave. Once the
   * governor owns a device, fencing guarantees no new legacy successes are created, so
   * this merge is deterministic and idempotent across process restarts.
   */
  async importLegacyNewsExposureHistory(deviceId: string, lookbackHours = 24): Promise<number> {
    if (!Number.isSafeInteger(lookbackHours) || lookbackHours < 1 || lookbackHours > 48) {
      throw new Error('Invalid legacy history lookback');
    }
    return this.transaction(async client => {
      const row = await this.locked(client, deviceId);
      if (!row) throw new Error('Device is not enrolled');
      const history = await client.query<{
        delivery_id: string; fingerprint: string | null; content_id: number;
        source: string | null; acknowledged_ms: string;
      }>(
        `SELECT DISTINCT ON (ci.id)
                d.id::text AS delivery_id,ci.fingerprint,ci.id AS content_id,ci.source,
                floor(extract(epoch FROM d.finished_at)*1000)::bigint AS acknowledged_ms
           FROM device_deliveries d
           JOIN content_inventory ci ON ci.id=d.content_id
          WHERE d.device_id=$1 AND d.state='succeeded' AND d.finished_at IS NOT NULL
            AND d.finished_at >= now()-($2 * INTERVAL '1 hour')
          ORDER BY ci.id,d.finished_at DESC`,
        [deviceId, lookbackHours]);
      if (history.rows.length === 0) return 0;

      const state = structuredClone(row.state);
      let changed = 0;
      let latestAtMs = 0;
      for (const item of history.rows) {
        const at = Number(item.acknowledged_ms);
        if (!Number.isSafeInteger(at) || at <= 0) continue;
        const key = `news:${item.fingerprint || item.content_id}`;
        const source = item.source || 'unknown';
        const existing = state.lastByContent[key];
        if (!existing || existing.acknowledgedAtMs < at) {
          state.lastByContent[key] = {
            candidateKey: key, exposureKey: key, source, kind: 'news', version: 'article-v1',
            acknowledgedAtMs: at, planId: `legacy-delivery:${item.delivery_id}`,
          };
          state.lastByExposure[key] = Math.max(state.lastByExposure[key] ?? 0, at);
          state.lastBySource[source] = Math.max(state.lastBySource[source] ?? 0, at);
          changed++;
          latestAtMs = Math.max(latestAtMs, at);
        }
      }
      if (!changed) return 0;
      state.revision++;
      state.lastClockMs = Math.max(state.lastClockMs, Number(row.now_ms));
      await client.query(
        `UPDATE display_governor_states SET state=$2::jsonb,updated_at=now() WHERE device_id=$1`,
        [deviceId, JSON.stringify(state)]);
      await this.event(client, state, 'legacy-history-imported', {
        articles: changed, lookbackHours, latestAtMs, evidence: 'legacy-delivery-succeeded',
      });
      return changed;
    });
  }

  async reserve(deviceId: string, candidates: readonly Candidate[], policy: Policy): Promise<Transition> {
    return this.transaction(async client => {
      const row = await this.locked(client, deviceId);
      if (!row) throw new Error('Device is not enrolled');
      const now = Number(row.now_ms);
      const state = pruneExposureHistory(row.state, now);
      const active = await client.query(
        `SELECT 1 FROM device_deliveries WHERE device_id=$1 AND state='leased'
          AND lease_expires_at > now() LIMIT 1`, [deviceId]);
      if (active.rowCount) {
        const decision = { kind: 'hold' as const, reason: 'uncertain-refresh' as const,
          wakeAtMs: now + 5000, excluded: { 'legacy-in-flight': 1 } };
        await client.query(`UPDATE display_governor_states SET last_decision=$2::jsonb,updated_at=now()
          WHERE device_id=$1`, [deviceId, JSON.stringify(decision)]);
        return { state, decision, events: [] };
      }
      const transition = reserve(state, candidates, now, policy);
      await client.query(
        `UPDATE display_governor_states SET state=$2::jsonb,last_decision=$3::jsonb,
                last_error=NULL,updated_at=now() WHERE device_id=$1`,
        [deviceId, JSON.stringify(transition.state), JSON.stringify(transition.decision)]);
      for (const name of transition.events) {
        await this.event(client, transition.state, name, transition.decision);
      }
      return transition;
    });
  }

  /** Rendering is outside the lock; the reservation and admission are checked again here. */
  async publish(deviceId: string, planId: string, prepared: PreparedBitmap, policy: Policy,
    stillAdmitted: AdmissionGuard): Promise<string> {
    const { bitmap, width, height } = prepared;
    if (!Buffer.isBuffer(bitmap) || !Number.isInteger(width) || !Number.isInteger(height) ||
        width < 8 || width > 4096 || width % 8 !== 0 || height < 1 || height > 4096 ||
        bitmap.length !== width * height / 8) throw new Error('Invalid mono bitplane geometry');
    return this.transaction(async client => {
      const row = await this.locked(client, deviceId);
      if (!row?.state.pending || row.state.pending.id !== planId) throw new Error('Stale publication');
      if (!await stillAdmitted(client, row.state.pending.candidate)) throw new Error('Candidate admission revoked');
      const now = Number(row.now_ms);
      // An opaque 16-hex token fits the existing pull-v2 wire grammar, but changes on EVERY
      // publication, including identical pixels. A delayed ACK can never confirm a later replay.
      const frameId = randomBytes(8).toString('hex');
      const frameCrc32 = crc32Hex(bitmap).toLowerCase();
      const sha256 = createHash('sha256').update(bitmap).digest('hex');
      const next = publish(row.state, planId, { ref: `pg-frame:${frameId}`, sha256, width, height }, now, policy);
      await client.query(
        `INSERT INTO device_frames(device_id,frame_data,frame_id,frame_crc32,width,height,plane_count,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,now())
         ON CONFLICT(device_id) DO UPDATE SET frame_data=EXCLUDED.frame_data,frame_id=EXCLUDED.frame_id,
           frame_crc32=EXCLUDED.frame_crc32,width=EXCLUDED.width,height=EXCLUDED.height,plane_count=1,updated_at=now()`,
        [deviceId, bitmap, frameId, frameCrc32, width, height]);
      await client.query(
        `UPDATE display_governor_states SET state=$2::jsonb,frame_id=$3,frame_crc32=$4,
           last_error=NULL,updated_at=now() WHERE device_id=$1`,
        [deviceId, JSON.stringify(next), frameId, frameCrc32]);
      await this.event(client, next, 'published', { planId, frameId, sha256,
        candidateKey: next.pending!.candidate.key, kind: next.pending!.candidate.kind,
        reason: next.pending!.reason, width, height });
      await client.query('SELECT pg_notify($1,$2)',
        ['quote0_device_frame_updates', JSON.stringify({ device_id: deviceId, frame_id: frameId })]);
      return frameId;
    });
  }

  async cancelRender(deviceId: string, planId: string, error: string): Promise<void> {
    await this.transaction(async client => {
      const row = await this.locked(client, deviceId);
      if (!row?.state.pending || row.state.pending.id !== planId || row.state.pending.phase !== 'reserved') return;
      const state = structuredClone(row.state);
      const now = Number(row.now_ms);
      state.uncertainCooldownUntil[state.pending!.candidate.exposureKey] = now + 60_000;
      state.pending = null;
      state.revision++;
      state.lastClockMs = now;
      await client.query(`UPDATE display_governor_states SET state=$2::jsonb,last_error=$3,updated_at=now()
        WHERE device_id=$1`, [deviceId, JSON.stringify(state), error.slice(0, 1000)]);
      await this.event(client, state, 'render-failed', { planId, error: error.slice(0, 1000) });
    });
  }

  /** Device identity is supplied by the authenticated API route, NOT the request body. */
  async acknowledgeFrame(deviceId: string, ack: DisplayAckPayload): Promise<{ accepted: boolean; reason: string } | null> {
    return this.transaction(async client => {
      const row = await this.locked(client, deviceId);
      if (!row) return null; // legacy device
      if (row.frame_id !== ack.frameId || row.frame_crc32 !== ack.crc32) {
        return { accepted: false, reason: 'stale-or-mismatched-wire-ack' };
      }
      const pending = row.state.pending;
      if (!pending?.frame) return { accepted: false, reason: 'no-pending-publication' };
      const bytes = await client.query<{ frame_data: Buffer }>(
        'SELECT frame_data FROM device_frames WHERE device_id=$1 AND frame_id=$2', [deviceId, ack.frameId]);
      const bitmap = bytes.rows[0]?.frame_data;
      if (!bitmap || createHash('sha256').update(bitmap).digest('hex') !== pending.frame.sha256) {
        return { accepted: false, reason: 'published-frame-integrity-mismatch' };
      }
      const result = acknowledge(row.state, { deviceId, planId: pending.id, sha256: pending.frame.sha256,
        result: ack.result === 'displayed' ? 'refreshed' : 'failed' }, Number(row.now_ms));
      if (result.accepted) {
        await client.query(`UPDATE display_governor_states SET state=$2::jsonb,last_error=NULL,updated_at=now()
          WHERE device_id=$1`, [deviceId, JSON.stringify(result.state)]);
        await this.event(client, result.state, 'refresh-confirmed', {
          frameId: ack.frameId, candidateKey: pending.candidate.key, exposureKey: pending.candidate.exposureKey,
          kind: pending.candidate.kind, source: pending.candidate.source, refreshMs: ack.refreshMs ?? null,
          protectedUntilMs: result.state.current!.protectedUntilMs,
        });
      } else {
        await this.event(client, row.state, 'ack-rejected', { frameId: ack.frameId, reason: result.reason });
      }
      return { accepted: result.accepted, reason: result.reason };
    });
  }
}

/** Used by getDeviceFrame in the SAME SELECT snapshot as the frame bytes. */
export function governorAuthorizesFrame(state: State, frameId: string | null, nowMs: number): boolean {
  const approved = authorizedFrame(state, nowMs);
  return Boolean(approved && approved.frame.ref === `pg-frame:${frameId}`);
}
