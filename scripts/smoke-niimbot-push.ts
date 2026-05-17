import http from 'http';
import { niimbotPush } from '../src/react-widgets/core/niimbot-push-module.js';
import { LABEL_T40X20_TARGET } from '../src/react-widgets/core/render-targets.js';

const PORT = 8765;
const DUMMY_BITMAP = Buffer.alloc(6400, 0xff);

let receivedBodyLength = -1;
let receivedWidthPx = '';
let receivedSku = '';

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    receivedBodyLength = body.length;
    receivedWidthPx = req.headers['x-width-px'] as string || '';
    receivedSku = req.headers['x-sku'] as string || '';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ printId: 'mock-123', queued: true, queue_position: 1 }));
  });
});

server.listen(PORT, async () => {
  console.log(`Mock Niimbot server listening on http://localhost:${PORT}`);

  const result = await niimbotPush.push(
    DUMMY_BITMAP,
    LABEL_T40X20_TARGET,
    `http://localhost:${PORT}/api/print/raw`
  );

  console.log('Push result:', result);

  // Assertions
  let exitCode = 0;
  if (receivedBodyLength !== 6400) {
    console.error(`❌ FAIL: body length expected 6400, got ${receivedBodyLength}`);
    exitCode = 1;
  } else {
    console.log('✅ body length === 6400');
  }

  if (receivedWidthPx !== '320') {
    console.error(`❌ FAIL: X-Width-Px expected "320", got "${receivedWidthPx}"`);
    exitCode = 1;
  } else {
    console.log('✅ X-Width-Px === "320"');
  }

  if (receivedSku !== LABEL_T40X20_TARGET.id) {
    console.error(`❌ FAIL: X-Sku expected "${LABEL_T40X20_TARGET.id}", got "${receivedSku}"`);
    exitCode = 1;
  } else {
    console.log('✅ X-Sku === target.id');
  }

  if (!result.queued) {
    console.error(`❌ FAIL: queued expected true, got ${result.queued}`);
    exitCode = 1;
  } else {
    console.log('✅ queued === true');
  }

  server.close(() => {
    process.exit(exitCode);
  });
});
