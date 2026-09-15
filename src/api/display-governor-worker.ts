import React from 'react';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { createEinkTarget } from '../react-widgets/core/render-targets.js';
import { SatoriWeatherWidget } from '../react-widgets/components/SatoriWeatherWidget.js';
import { satoriRenderer } from '../react-widgets/core/satori-renderer.js';
import { buildRenderableFromInventory } from './device-delivery-worker.js';
import { renderSingleEinkTarget } from './target-aware-eink.js';
import { getEinkDevices, pngTo1BitBitmap, type EinkDevice } from './eink-converter.js';
import { readDeliveryPngPayload } from './delivery-payload-store.js';
import { configuredGovernorDevices, displayGovernorPolicy } from './display-governor-config.js';
import { DisplayGovernorStore, type PreparedBitmap } from './display-governor-store.js';
import { candidateStillAdmitted, listGovernorCandidates, loadAdmittedInventory,
  loadAdmittedPeriodic } from './display-governor-catalog.js';
import type { Candidate, Policy } from './display-governor.js';

let running = false;
let workerEpoch = 0;
const legacyHistoryBootstrapped = new Set<string>();

export async function renderGovernorCandidate(pool: Pool, candidate: Candidate, device: EinkDevice): Promise<PreparedBitmap> {
  if (!Number.isInteger(device.width) || !Number.isInteger(device.height) || device.width % 8 !== 0) {
    throw new Error('Governor requires a registered byte-aligned mono target');
  }
  let png: Buffer;
  if (candidate.kind === 'news') {
    const item = await loadAdmittedInventory(pool, candidate);
    if (!item) throw new Error('News snapshot changed or admission revoked');
    const result = await renderSingleEinkTarget(buildRenderableFromInventory(item),
      createEinkTarget(device.width, device.height));
    if (!result.localImagePath) throw new Error('News renderer did not produce a PNG');
    png = await readFile(result.localImagePath);
  } else {
    const payload = await loadAdmittedPeriodic(pool, candidate);
    if (!payload) throw new Error('Periodic snapshot changed, expired, or its job was disabled');
    if (payload.kind === 'weather' && payload.weather) {
      await satoriRenderer.initialize();
      png = await satoriRenderer.renderToImage(React.createElement(SatoriWeatherWidget, {
        data: payload.weather, target: createEinkTarget(device.width, device.height),
      }),
        { width: device.width, height: device.height, backgroundColor: '#ffffff' });
    } else if (payload.kind === 'memo' && payload.pngRef && payload.pngHash) {
      png = await readDeliveryPngPayload(payload.pngRef, payload.pngHash);
    } else throw new Error('Invalid periodic payload');
  }
  return { bitmap: await pngTo1BitBitmap(png, device.width, device.height),
    width: device.width, height: device.height };
}

/** One real vertical slice, exported for integration tests and bounded shadow/replay harnesses. */
export async function runGovernorDeviceTick(store: DisplayGovernorStore, device: EinkDevice,
  candidates: readonly Candidate[], policy: Policy,
  render = renderGovernorCandidate, mayPublish: () => boolean = () => true): Promise<void> {
  const transition = await store.reserve(device.id, candidates, policy);
  const pending = transition.state.pending;
  if (transition.decision.kind !== 'select' || !pending) return;
  try {
    const prepared = await render(store.pool, pending.candidate, device);
    if (!mayPublish()) throw new Error('Governor worker stopped during render');
    await store.publish(device.id, pending.id, prepared, policy, candidateStillAdmitted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.cancelRender(device.id, pending.id, message);
    throw error;
  }
}

/** No automatic enrollment of a non-ACK/unauthenticated/printing device. */
async function ensureEnrollment(store: DisplayGovernorStore, deviceId: string): Promise<void> {
  const devices = await store.pool.query<{ enabled: boolean; kind: string; token: string; color_mode: string; plane_count: number }>(
    'SELECT enabled,kind,token,color_mode,plane_count FROM push_devices WHERE id=$1', [deviceId]);
  const device = devices.rows[0];
  if (!device || !device.enabled || device.kind !== 'eink-local' || !device.token ||
      device.plane_count !== 1 || device.color_mode !== 'mono-1bit') {
    throw new Error(`Governor enrollment requires an enabled, authenticated mono local E-Ink device: ${deviceId}`);
  }
  const exists = await store.pool.query('SELECT device_id FROM display_governor_states WHERE device_id=$1', [deviceId]);
  if (exists.rowCount) return;
  const ack = await store.pool.query(
    `SELECT 1 FROM device_frame_acks WHERE device_id=$1 AND result='displayed'
      AND current_match=true AND crc_verified=true AND acked_at > now() - INTERVAL '15 minutes' LIMIT 1`, [deviceId]);
  if (!ack.rowCount) throw new Error(`Governor enrollment requires a recent verified pull refresh ACK: ${deviceId}`);
  await store.enroll(deviceId);
}

export function startDisplayGovernorWorker(): void {
  if (running) return;
  const ids = configuredGovernorDevices();
  if (!ids.length) return;
  const policy = displayGovernorPolicy(); // invalid config fails closed; no silent downgrade
  running = true;
  legacyHistoryBootstrapped.clear();
  const epoch = ++workerEpoch;
  console.log(`Display governor enabled for ${ids.join(', ')} (pull-v2, confirmed-refresh accounting)`);
  void (async () => {
    const db = getPostgresDatabase();
    await db.initialize();
    const store = new DisplayGovernorStore(db.getPool());
    while (running && workerEpoch === epoch) {
      try {
        const candidates = await listGovernorCandidates(store.pool);
        const devices = await getEinkDevices({ deviceIds: ids });
        for (const id of ids) {
          if (!running || workerEpoch !== epoch) break;
          try {
            await ensureEnrollment(store, id);
            if (!legacyHistoryBootstrapped.has(id)) {
              const imported = await store.importLegacyNewsExposureHistory(id);
              legacyHistoryBootstrapped.add(id);
              console.log(`Display governor ${id}: legacy exposure baseline imported=${imported}`);
            }
            const device = devices.find(value => value.id === id);
            if (!device) throw new Error(`Governor device unavailable: ${id}`);
            await runGovernorDeviceTick(store, device, candidates, policy, renderGovernorCandidate,
              () => running && workerEpoch === epoch);
          } catch (error) {
            console.error(`Display governor ${id}:`, error instanceof Error ? error.message : error);
          }
        }
      } catch (error) {
        console.error('Display governor catalog/tick:', error instanceof Error ? error.message : error);
      }
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); });
    }
  })().catch(error => {
    running = false;
    console.error('Display governor startup failed; owned devices remain fenced:', error);
  });
}
export function stopDisplayGovernorWorker(): void { running = false; workerEpoch++; }
