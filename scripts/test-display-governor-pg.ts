#!/usr/bin/env bun
/** Ephemeral PostgreSQL harness. Never connects to an existing or production database.
 * initdb owns a new private temp directory; only this harness's server is stopped.
 * Leaves the stopped cluster/logs for inspection instead of recursively deleting files.
 */
import { mkdtemp, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';

function run(command: string, args: string[], env = process.env): number {
  // macOS PostgreSQL must not initialize CoreFoundation locale threads before forking.
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...env, LC_ALL: 'C', LANG: 'C' }, timeout: 90_000 });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  return result.status ?? 1;
}
function checked(command: string, args: string[]): void {
  const code = run(command, args);
  if (code !== 0) throw new Error(`${command} exited ${code}`);
}
const root = await mkdtemp(join(tmpdir(), 'q0-governor-pg-'));
await chmod(root, 0o700);
const data = join(root, 'data');
const server = createServer();
await new Promise<void>((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Failed to reserve loopback port');
const port = address.port;
await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
let started = false;
let exitCode = 1;
console.log(JSON.stringify({ testCluster: root, host: '127.0.0.1', port, database: 'q0_display_governor_test' }));
try {
  checked('initdb', ['-D', data, '-A', 'trust', '-U', 'q0_test', '--no-locale', '-E', 'UTF8']);
  // Empty Unix socket directory avoids macOS's long TMPDIR socket path limit.
  checked('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=Asia/Shanghai`, '-w', '-t', '20', 'start']);
  started = true;
  checked('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'q0_test', 'q0_display_governor_test']);
  exitCode = run(process.execPath, ['test', '--path-ignore-patterns=dist/**', './src/api/display-governor.pg.test.ts'], {
    ...process.env,
    Q0_GOVERNOR_PG_URL: `postgresql://q0_test@127.0.0.1:${port}/q0_display_governor_test`,
    QUOTE0_DISPLAY_GOVERNOR_DEVICES: '',
  });
} catch (error) {
  console.error('Isolated PostgreSQL harness failed:', error);
  try {
    console.error((await readFile(join(root, 'postgres.log'), 'utf8')).slice(-16_384));
  } catch { console.error('PostgreSQL did not create its diagnostic log.'); }
  exitCode = 1;
} finally {
  if (started) {
    const stopped = run('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '20', 'stop']);
    if (stopped !== 0) exitCode = stopped;
    console.log(`Isolated PostgreSQL stop exit=${stopped}; diagnostic files retained at ${root}`);
  }
}
process.exitCode = exitCode;
