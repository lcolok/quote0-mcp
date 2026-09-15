import type { Pool } from 'pg';

/** Only stubs DB transport, not the ownership decision or physical protocol code.
 * Tests that need ownership/concurrency guarantees use the real isolated PostgreSQL suite.
 */
export function stubLegacyOwnershipDatabase(database: { getPool(): Pool }): () => void {
  const original = database.getPool;
  const query = async (sql: string) => {
    if (!/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT pg_advisory|SELECT device_id FROM display_governor_states|SELECT p.base_url FROM push_devices)/.test(sql.trim())) {
      throw new Error(`Unexpected ownership fixture SQL: ${sql}`);
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
  } as unknown as Pool;
  database.getPool = () => pool;
  return () => { database.getPool = original; };
}
