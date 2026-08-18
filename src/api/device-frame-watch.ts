/**
 * PostgreSQL LISTEN/NOTIFY fan-out for E-Ink long-poll requests.
 *
 * device_frames is the SSoT. Writers call pg_notify after an upsert; this
 * module keeps one dedicated LISTEN connection per news-api process and fans
 * the event out to any waiting HTTP requests. No per-device DB polling loop.
 *
 * The listener remembers the most recent observed frame id per device. The
 * endpoint establishes LISTEN before reading device_frames, so an update that
 * lands in the small read→wait registration window is still detected.
 */

import type { PoolClient, Notification } from 'pg';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';

export const DEVICE_FRAME_NOTIFY_CHANNEL = 'quote0_device_frame_updates';

export type DeviceFrameWaitResult = 'changed' | 'timeout' | 'listener_error' | 'aborted';

interface FrameUpdatePayload {
  device_id: string;
  frame_id: string;
}

interface Waiter {
  afterFrameId: string;
  finish: (result: DeviceFrameWaitResult) => void;
}

let listenerClient: PoolClient | null = null;
let listenerPromise: Promise<void> | null = null;
const waiters = new Map<string, Set<Waiter>>();
const latestObservedFrame = new Map<string, string>();

function parseNotification(message: Notification): FrameUpdatePayload | null {
  if (message.channel !== DEVICE_FRAME_NOTIFY_CHANNEL || !message.payload) return null;
  try {
    const parsed = JSON.parse(message.payload) as Partial<FrameUpdatePayload>;
    if (typeof parsed.device_id !== 'string' || typeof parsed.frame_id !== 'string') return null;
    if (!parsed.device_id || !parsed.frame_id) return null;
    return { device_id: parsed.device_id, frame_id: parsed.frame_id };
  } catch {
    return null;
  }
}

function fanOutUpdate(payload: FrameUpdatePayload): void {
  latestObservedFrame.set(payload.device_id, payload.frame_id);
  const deviceWaiters = waiters.get(payload.device_id);
  if (!deviceWaiters) return;
  for (const waiter of [...deviceWaiters]) {
    if (payload.frame_id !== waiter.afterFrameId) waiter.finish('changed');
  }
}

function failAllWaiters(): void {
  for (const deviceWaiters of waiters.values()) {
    for (const waiter of [...deviceWaiters]) waiter.finish('listener_error');
  }
}

function handleListenerFailure(error?: unknown): void {
  if (error) {
    console.warn('E-Ink frame LISTEN connection lost:', error instanceof Error ? error.message : error);
  }
  const client = listenerClient;
  listenerClient = null;
  listenerPromise = null;
  if (client) {
    try { client.release(true); } catch { /* connection is already dead */ }
  }
  failAllWaiters();
}

export async function ensureDeviceFrameListener(): Promise<void> {
  if (listenerClient) return;
  if (listenerPromise) return listenerPromise;

  listenerPromise = (async () => {
    const client = await getPostgresDatabase().getPool().connect();
    try {
      client.on('notification', (message) => {
        const payload = parseNotification(message);
        if (payload) fanOutUpdate(payload);
      });
      client.once('error', handleListenerFailure);
      client.once('end', () => handleListenerFailure());
      await client.query(`LISTEN ${DEVICE_FRAME_NOTIFY_CHANNEL}`);
      listenerClient = client;
    } catch (error) {
      try { client.release(true); } catch { /* ignore */ }
      listenerPromise = null;
      throw error;
    }
  })();

  try {
    await listenerPromise;
  } finally {
    // A healthy listener is represented by listenerClient; the promise is only
    // a startup de-duplication guard and must not mask a later reconnect.
    listenerPromise = null;
  }
}

export async function notifyDeviceFrameUpdated(deviceId: string, frameId: string): Promise<void> {
  const payload = JSON.stringify({ device_id: deviceId, frame_id: frameId });
  await getPostgresDatabase().getPool().query(
    'SELECT pg_notify($1, $2)',
    [DEVICE_FRAME_NOTIFY_CHANNEL, payload],
  );
}

export async function waitForDeviceFrameUpdate(params: {
  deviceId: string;
  afterFrameId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<DeviceFrameWaitResult> {
  const timeoutMs = Math.max(1, params.timeoutMs);
  try {
    await ensureDeviceFrameListener();
  } catch (error) {
    console.warn('E-Ink frame listener unavailable:', error instanceof Error ? error.message : error);
    return 'listener_error';
  }

  return new Promise<DeviceFrameWaitResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deviceWaiters = waiters.get(params.deviceId) ?? new Set<Waiter>();
    waiters.set(params.deviceId, deviceWaiters);

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      params.signal?.removeEventListener('abort', onAbort);
      deviceWaiters.delete(waiter);
      if (deviceWaiters.size === 0) waiters.delete(params.deviceId);
    };
    const finish = (result: DeviceFrameWaitResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const waiter: Waiter = { afterFrameId: params.afterFrameId, finish };
    const onAbort = () => finish('aborted');

    deviceWaiters.add(waiter);
    params.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish('timeout'), timeoutMs);

    // Close the read→wait race: LISTEN was established before the endpoint read
    // device_frames, and notifications received since then are remembered here.
    const observed = latestObservedFrame.get(params.deviceId);
    if (observed && observed !== params.afterFrameId) finish('changed');
    if (params.signal?.aborted) finish('aborted');
  });
}
