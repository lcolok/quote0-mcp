import { Socket } from 'node:net';

interface Endpoint {
  name: string;
  host: string;
  port: number;
  source: string;
}

function parsePostgresEndpoint(): Endpoint {
  const raw = process.env.TEST_DATABASE_URL
    || 'postgresql://quote0_user:quote0_password@localhost:25432/quote0_cache';
  const url = new URL(raw);
  return {
    name: 'PostgreSQL',
    host: url.hostname,
    port: Number(url.port || 5432),
    source: 'TEST_DATABASE_URL',
  };
}

function parseMinioEndpoint(): Endpoint {
  const rawHost = process.env.MINIO_ENDPOINT || 'localhost';
  let host = rawHost;
  if (rawHost.includes('://')) {
    host = new URL(rawHost).hostname;
  }
  return {
    name: 'MinIO',
    host,
    // preflight 从宿主机执行；docker-compose 将 MinIO API 9000 映射到宿主 29000。
    port: Number(process.env.MINIO_PORT || 29000),
    source: 'MINIO_ENDPOINT/MINIO_PORT',
  };
}

function checkTcp(endpoint: Endpoint, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error('timeout')));
    socket.once('error', (error) => finish(error));
    socket.connect(endpoint.port, endpoint.host);
  });
}

const endpoints = [parsePostgresEndpoint(), parseMinioEndpoint()];
const checks = await Promise.all(endpoints.map(async (endpoint) => {
  try {
    await checkTcp(endpoint);
    return { endpoint, ok: true as const };
  } catch (error) {
    return {
      endpoint,
      ok: false as const,
      reason: error instanceof Error ? (error as NodeJS.ErrnoException).code || error.message : String(error),
    };
  }
}));

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const mark = check.ok ? '✅' : '❌';
  console.log(`${mark} ${check.endpoint.name} ${check.endpoint.host}:${check.endpoint.port}`);
}

if (failed.length > 0) {
  console.error('\nIntegration 依赖未就绪：');
  for (const check of failed) {
    console.error(
      `- ${check.endpoint.name} ${check.endpoint.host}:${check.endpoint.port} (${check.endpoint.source})` +
      `: ${check.reason}`,
    );
  }
  console.error('\n本地默认可用：docker compose up -d postgres minio');
  process.exit(1);
}

console.log('\nIntegration 依赖检查通过。');
