#!/usr/bin/env bun

import { configuredGovernorDevices } from '../src/api/display-governor-config.js';
import { DisplayGovernorStore } from '../src/api/display-governor-store.js';
import { getPostgresDatabase } from '../src/react-widgets/core/postgres-database.js';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const deviceId = argValue('--device')?.trim();
const confirmed = process.argv.includes('--confirm');
if (!deviceId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(deviceId)) {
  console.error('Usage: bun scripts/release-display-governor.ts --device <device-id> --confirm');
  process.exit(2);
}
if (!confirmed) {
  console.error('Refusing release without --confirm');
  process.exit(2);
}
if (configuredGovernorDevices().includes(deviceId)) {
  console.error(`Refusing release: ${deviceId} is still present in QUOTE0_DISPLAY_GOVERNOR_DEVICES`);
  process.exit(3);
}

const database = getPostgresDatabase();
await database.initialize();
const store = new DisplayGovernorStore(database.getPool());
const released = await store.release(deviceId);
console.log(JSON.stringify({ deviceId, released, retainedFrame: true }));
await database.close?.();
