import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type NumericKeys =
  | 'cooldownHoursStrict'
  | 'maxPushCountStrict'
  | 'recentFingerprintsLimitStrict'
  | 'cooldownHoursRelaxed'
  | 'maxPushCountRelaxed'
  | 'recentFingerprintsLimitRelaxed'
  | 'fallbackRepeatLimit'
  | 'sourceFailureSkipThreshold'
  | 'recentFingerprintGlobalLimit'
  | 'recentFingerprintSnapshotSize';

export type StrategyLayerKey = 'strict' | 'relaxed' | 'fallback' | 'override';

export interface SchedulerStrategyConfig {
  version: string;
  cooldownHoursStrict: number;
  maxPushCountStrict: number;
  recentFingerprintsLimitStrict: number;
  cooldownHoursRelaxed: number;
  maxPushCountRelaxed: number;
  recentFingerprintsLimitRelaxed: number;
  fallbackRepeatLimit: number;
  sourceFailureSkipThreshold: number;
  recentFingerprintGlobalLimit: number;
  recentFingerprintSnapshotSize: number;
}

const DEFAULT_CONFIG: SchedulerStrategyConfig = {
  version: '1.0.0',
  cooldownHoursStrict: 6,
  maxPushCountStrict: 3,
  recentFingerprintsLimitStrict: 10,
  cooldownHoursRelaxed: 3,
  maxPushCountRelaxed: 6,
  recentFingerprintsLimitRelaxed: 5,
  fallbackRepeatLimit: 2,
  sourceFailureSkipThreshold: 3,
  recentFingerprintGlobalLimit: 24,
  recentFingerprintSnapshotSize: 12
};

const NUMERIC_KEYS: NumericKeys[] = [
  'cooldownHoursStrict',
  'maxPushCountStrict',
  'recentFingerprintsLimitStrict',
  'cooldownHoursRelaxed',
  'maxPushCountRelaxed',
  'recentFingerprintsLimitRelaxed',
  'fallbackRepeatLimit',
  'sourceFailureSkipThreshold',
  'recentFingerprintGlobalLimit',
  'recentFingerprintSnapshotSize'
];

const ENV_MAP: Partial<Record<NumericKeys | 'version', string>> = {
  cooldownHoursStrict: 'NEWS_STRATEGY_COOLDOWN_STRICT',
  maxPushCountStrict: 'NEWS_STRATEGY_MAX_PUSH_STRICT',
  recentFingerprintsLimitStrict: 'NEWS_STRATEGY_RECENT_LIMIT_STRICT',
  cooldownHoursRelaxed: 'NEWS_STRATEGY_COOLDOWN_RELAXED',
  maxPushCountRelaxed: 'NEWS_STRATEGY_MAX_PUSH_RELAXED',
  recentFingerprintsLimitRelaxed: 'NEWS_STRATEGY_RECENT_LIMIT_RELAXED',
  fallbackRepeatLimit: 'NEWS_STRATEGY_FALLBACK_REPEAT',
  sourceFailureSkipThreshold: 'NEWS_STRATEGY_SOURCE_FAILURE_SKIP',
  recentFingerprintGlobalLimit: 'NEWS_STRATEGY_RECENT_GLOBAL_LIMIT',
  recentFingerprintSnapshotSize: 'NEWS_STRATEGY_RECENT_SNAPSHOT',
  version: 'NEWS_STRATEGY_VERSION'
};

let cachedConfig: SchedulerStrategyConfig | null = null;

function loadConfigFromFile(): Partial<SchedulerStrategyConfig> {
  const configPath = path.resolve(process.cwd(), 'config', 'scheduler-strategy.json');
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed ?? {};
  } catch (error) {
    console.warn('⚠️ 读取 scheduler-strategy.json 失败，将使用默认策略:', error);
    return {};
  }
}

function applyEnvOverrides(base: SchedulerStrategyConfig): SchedulerStrategyConfig {
  const result = { ...base };
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    const value = envName ? process.env[envName] : undefined;
    if (value === undefined || value === '') {
      continue;
    }

    if (key === 'version') {
      result.version = value;
      continue;
    }

    if (NUMERIC_KEYS.includes(key as NumericKeys)) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        (result as any)[key] = parsed;
      }
    }
  }
  return result;
}

function deriveConfig(config: SchedulerStrategyConfig): SchedulerStrategyConfig {
  const maxRecentConstraint = Math.max(
    config.recentFingerprintsLimitStrict,
    config.recentFingerprintsLimitRelaxed,
    config.fallbackRepeatLimit * 2
  );

  if (!config.recentFingerprintGlobalLimit || config.recentFingerprintGlobalLimit < maxRecentConstraint) {
    config.recentFingerprintGlobalLimit = maxRecentConstraint + 6;
  }

  if (!config.recentFingerprintSnapshotSize || config.recentFingerprintSnapshotSize < 4) {
    config.recentFingerprintSnapshotSize = Math.min(config.recentFingerprintGlobalLimit, 12);
  }

  return config;
}

function buildConfig(): SchedulerStrategyConfig {
  const fileConfig = loadConfigFromFile();
  const merged: SchedulerStrategyConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig
  } as SchedulerStrategyConfig;

  const withEnv = applyEnvOverrides(merged);
  return deriveConfig(withEnv);
}

export function getSchedulerStrategyConfig(): SchedulerStrategyConfig {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }
  return cachedConfig;
}

export function reloadSchedulerStrategyConfig(): SchedulerStrategyConfig {
  cachedConfig = null;
  return getSchedulerStrategyConfig();
}
