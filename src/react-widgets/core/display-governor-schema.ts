/** Additive migration only. No production job/config rewrite and no automatic enrollment. */
export const DISPLAY_GOVERNOR_DDL = [
  `CREATE TABLE IF NOT EXISTS display_governor_states (
    device_id TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    frame_id TEXT,
    frame_crc32 TEXT,
    last_decision JSONB,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (state->>'schema' = 'quote0-display-governor/v1'),
    CHECK (state->>'deviceId' = device_id)
  )`,
  `CREATE TABLE IF NOT EXISTS display_governor_candidates (
    candidate_key TEXT PRIMARY KEY,
    producer_job_id TEXT NOT NULL,
    candidate JSONB NOT NULL,
    payload JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (candidate->>'kind' IN ('weather','memo')),
    CHECK (candidate->>'key' = candidate_key),
    CHECK (expires_at > observed_at)
  )`,
  `CREATE TABLE IF NOT EXISTS display_governor_events (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    event TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_display_governor_events_device_time
     ON display_governor_events(device_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_display_governor_candidates_expiry
     ON display_governor_candidates(expires_at)`,
];
