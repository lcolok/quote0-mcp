import { DEFAULT_DISPLAY_POLICY, MINUTE, validatePolicy, type Policy } from './display-governor.js';

/** Explicit allowlist. A typo fails closed rather than silently re-enabling legacy writers. */
export function configuredGovernorDevices(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.QUOTE0_DISPLAY_GOVERNOR_DEVICES?.trim() || '';
  if (!raw) return [];
  const ids = [...new Set(raw.split(',').map(value => value.trim()))];
  if (ids.length > 32 || ids.some(id => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id))) {
    throw new Error('Invalid QUOTE0_DISPLAY_GOVERNOR_DEVICES (explicit device IDs required; no wildcard)');
  }
  return ids;
}

export function displayGovernorPolicy(env: NodeJS.ProcessEnv = process.env): Policy {
  const p = structuredClone(DEFAULT_DISPLAY_POLICY);
  const minutes = (key: string, fallback: number, minimum: number): number => {
    const text = env[key];
    if (text === undefined) return fallback;
    const value = Number(text);
    if (!text.trim() || !Number.isSafeInteger(value) || value < minimum || value > 1440) {
      throw new Error(`${key} must be an integer in [${minimum},1440] minutes`);
    }
    return value * MINUTE;
  };
  const dwell = minutes('QUOTE0_DISPLAY_MIN_DWELL_MINUTES', MINUTE, 1);
  for (const rule of Object.values(p.rules)) rule.minimumDwellMs = dwell;
  p.rules.news.repeatCooldownMs = minutes('QUOTE0_DISPLAY_NEWS_COOLDOWN_MINUTES', 45 * MINUTE, 1);
  p.rules.weather.periodicIntervalMs = minutes('QUOTE0_DISPLAY_WEATHER_INTERVAL_MINUTES', 30 * MINUTE, 1);
  p.rules.weather.repeatCooldownMs = p.rules.weather.periodicIntervalMs;
  p.rules.memo.periodicIntervalMs = minutes('QUOTE0_DISPLAY_MEMO_INTERVAL_MINUTES', 30 * MINUTE, 1);
  p.rules.memo.repeatCooldownMs = p.rules.memo.periodicIntervalMs;
  p.sourceSilenceMs = minutes('QUOTE0_DISPLAY_SOURCE_SILENCE_MINUTES', 60 * MINUTE, 1);
  validatePolicy(p);
  return p;
}
