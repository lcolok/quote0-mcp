import type { Pool, PoolClient } from 'pg';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { configuredGovernorDevices } from './display-governor-config.js';

/** Persisted ownership also fences a device after an env entry is removed (paused). */
export async function governedDeviceIds(pool: Pool = getPostgresDatabase().getPool()): Promise<Set<string>> {
  const requested = configuredGovernorDevices();
  const rows = await pool.query<{ device_id: string }>('SELECT device_id FROM display_governor_states');
  return new Set([...requested, ...rows.rows.map(row => row.device_id).filter(id => typeof id === 'string')]);
}

export const displayOwnershipLockKey = (deviceId: string): string => `quote0-display:${deviceId}`;
export function displayEndpointLockKey(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid display endpoint');
  }
  return `quote0-display-endpoint:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * A shared transaction lock covers the complete legacy side effect. Enrollment takes
 * the exclusive version of the same lock, closing check-then-send/cache-write races.
 * Database failure is fail-closed: it must never become permission to replace a frame.
 */
export async function withLegacyDisplayPermit<T>(deviceId: string, pool: Pool,
  operation: (client: PoolClient) => Promise<T>, physicalEndpoint?: string): Promise<{ permitted: boolean; value?: T }> {
  if (configuredGovernorDevices().includes(deviceId)) return { permitted: false };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'");
    if (physicalEndpoint) {
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [displayEndpointLockKey(physicalEndpoint)]);
    }
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [displayOwnershipLockKey(deviceId)]);
    const owner = await client.query('SELECT device_id FROM display_governor_states WHERE device_id=$1', [deviceId]);
    if (owner.rows.some(row => row.device_id === deviceId)) {
      await client.query('COMMIT');
      return { permitted: false };
    }
    if (physicalEndpoint) {
      const endpoints = await client.query<{ base_url: string }>(
        `SELECT p.base_url FROM push_devices p WHERE
           p.id = ANY($1::text[]) OR EXISTS (SELECT 1 FROM display_governor_states g WHERE g.device_id=p.id)`,
        [configuredGovernorDevices()]);
      const key = displayEndpointLockKey(physicalEndpoint);
      if (endpoints.rows.some(row => displayEndpointLockKey(row.base_url) === key)) {
        await client.query('COMMIT');
        return { permitted: false }; // another configured ID aliases the same physical screen
      }
    }
    const value = await operation(client);
    await client.query('COMMIT');
    return { permitted: true, value };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function isGovernedDevice(deviceId: string): Promise<boolean> {
  if (configuredGovernorDevices().includes(deviceId)) return true;
  const result = await getPostgresDatabase().getPool().query(
    'SELECT device_id FROM display_governor_states WHERE device_id=$1', [deviceId]);
  return result.rows.some(row => row.device_id === deviceId);
}
