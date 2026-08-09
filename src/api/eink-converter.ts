/**
 * e-ink 图片格式转换器与推送协议适配层。
 * 位图本身仍是 MSB-first、bit=1 表示黑；设备协议由 wireProtocol 决定：
 * - legacy-raw-v0：C3 早期固件，body 只有裸位图
 * - epd1-v1：统一内核，body = 16B EPD1 PushHeader + 平面
 */

import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { EINK_DEVICE_WIDTH as EINK_WIDTH, EINK_DEVICE_HEIGHT as EINK_HEIGHT } from '../react-widgets/core/device-constants.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { createEinkTarget, type RenderTarget } from '../react-widgets/core/render-targets.js';

const EINK_BITMAP_SIZE = (EINK_WIDTH * EINK_HEIGHT) / 8; // 5624
const EPD_TRACE_HEADER = 'X-EPD-Trace-Id';
const EPD_CRC32_HEADER = 'X-EPD-CRC32';

/** 标准 IEEE CRC32（poly 0xEDB88320），用于校验“HTTP 收到的完整逻辑帧”而非替代 TCP checksum。 */
export function crc32Ieee(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(data: Uint8Array): string {
  return crc32Ieee(data).toString(16).padStart(8, '0');
}

/** trace 只用于关联日志/DB/板端状态，不承担认证；限制为 header-safe 的 32 字符。 */
export function normalizeEpdTraceId(value?: string): string {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return cleaned || randomBytes(8).toString('hex');
}

export type EinkWireProtocol = 'legacy-raw-v0' | 'epd1-v1';
export type EinkColorMode = 'mono-1bit' | '3-color';

export interface EinkDevice {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
  width: number;
  height: number;
  wireProtocol?: EinkWireProtocol;
  colorMode?: EinkColorMode;
  planeCount?: number;
}

export interface EinkDeviceQuery {
  /** 只返回这些设备；未提供时保持原有的“推送到全部启用设备”行为。 */
  deviceIds?: string[];
}

function normalizeEinkDevice(device: Partial<EinkDevice> & Pick<EinkDevice, 'id' | 'name' | 'baseUrl' | 'token'>): EinkDevice {
  return {
    ...device,
    width: device.width || EINK_WIDTH,
    height: device.height || EINK_HEIGHT,
    wireProtocol: device.wireProtocol ?? 'legacy-raw-v0',
    colorMode: device.colorMode ?? 'mono-1bit',
    planeCount: device.planeCount ?? 1,
  };
}

/**
 * 获取 E-Ink 设备列表
 * 优先从环境变量 EINK_DEVICES_JSON 读取，fallback 到配置文件
 */
export async function getEinkDevices(options: EinkDeviceQuery = {}): Promise<EinkDevice[]> {
  const targetIds = options.deviceIds?.length ? new Set(options.deviceIds) : null;

  const selectTargets = (devices: EinkDevice[]): EinkDevice[] =>
    targetIds ? devices.filter((device) => targetIds.has(device.id)) : devices;

  // DB 优先
  try {
    const rows = await getPostgresDatabase().getEnabledPushDevices();
    // 设备化:只取 eink-local 设备。push_devices 现在混装多种 kind(thermal-printer 等),
    // 不过滤会把 niimbot 打印机也当墨水屏,导致 local-eink 推送把 bitmap 误发到打印端点。
    const einkRows = rows.filter(r => r.kind === 'eink-local');
    if (einkRows.length > 0 || targetIds) {
      console.log(`📋 从 DB push_devices 读取 E-Ink 设备列表: ${einkRows.length} 个 eink-local 设备(共 ${rows.length} 台启用)`);
      return selectTargets(einkRows.map(r => normalizeEinkDevice({
        id: r.id,
        name: r.name,
        baseUrl: r.base_url,
        token: r.token,
        width: r.width,
        height: r.height,
        wireProtocol: r.wire_protocol as EinkWireProtocol,
        colorMode: r.color_mode as EinkColorMode,
        planeCount: r.plane_count,
      })));
    }
  } catch (e) {
    console.warn('⚠️ 从 DB 读取 push_devices 失败，回退 env/文件:', e);
  }

  // 优先读取环境变量
  const envJson = process.env.EINK_DEVICES_JSON;
  if (envJson && envJson !== '<set-via-lazycat-console>') {
    try {
      const devices = JSON.parse(envJson);
      console.log(`📋 从环境变量读取 E-Ink 设备列表: ${devices.length} 个设备`);
      return selectTargets(devices.map(normalizeEinkDevice));
    } catch (error) {
      console.error('❌ 解析 EINK_DEVICES_JSON 环境变量失败:', error);
    }
  }

  // Fallback: 读取配置文件
  try {
    const fs = await import('fs/promises');
    const { join } = await import('path');
    const configPath = join(process.cwd(), 'config', 'eink-devices.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const devices = JSON.parse(content);
    console.log(`📋 从配置文件读取 E-Ink 设备列表: ${devices.length} 个设备`);
    return selectTargets(devices.map(normalizeEinkDevice));
  } catch (error) {
    console.warn('⚠️ 未找到 E-Ink 设备配置，返回空列表');
    return [];
  }
}

export interface PushToEinkOptions {
  /**
   * 已在本次推送链路中取得的 /status 快照。
   *
   * Phase 0 止血①：单次推送链路中每台设备最多探测一次 /status。
   * resolveEinkDeviceSpec 已经打过 /status 的话，把快照顺着传下来，
   * epd1-v1 的规格校验就用它做纯比对，不再发第二次请求。
   * 未提供时（老调用方 / 直接调用）退回自己探一次，行为与改动前一致。
   */
  statusSnapshot?: EinkStatus;
  /** 端到端关联 ID；worker 会使用 delivery id + attempt，其他调用方未传时自动生成。 */
  traceId?: string;
}

export interface EinkPushResult {
  ok: boolean;
  ts?: number;
  error?: string;
  /** 兼容字段：成功时优先是设备 ACK 值，旧固件则回退为请求值。 */
  traceId?: string;
  crc32?: string;
  /** 明确区分请求证据与设备 ACK，供 attempt ledger 长期保存。 */
  requestTraceId?: string;
  requestCrc32?: string;
  bodyBytes?: number;
  ackTraceId?: string;
  ackCrc32?: string;
  /** HTTP 非 2xx 且响应体是 JSON 时保留板端结构化错误。 */
  deviceError?: unknown;
}

// 同一物理 E-Ink 端点只能有一个 POST /display/bitmap 在途。
// Phase 1 delivery worker 之外仍存在 weather/memo/manual 等直接推送路径；若它们和 worker
// 同时命中同一 ESP32，板端单缓冲 onBody 状态机会互相打断，实测触发 stale_body_resets / empty_body。
// 这里作为中央防线按物理 endpoint 串行；不同设备仍保持并行。
const einkPushTails = new Map<string, Promise<void>>();

function einkPushLockKey(device: EinkDevice): string {
  try {
    const url = new URL(device.baseUrl);
    const port = url.port || (url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '');
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch {
    return device.baseUrl.replace(/\/+$/, '') || device.id;
  }
}

async function withEinkDevicePushLock<T>(device: EinkDevice, fn: () => Promise<T>): Promise<T> {
  const key = einkPushLockKey(device);
  const previous = einkPushTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  einkPushTails.set(key, tail);

  const waitStartedAt = Date.now();
  await previous.catch(() => {});
  const waitedMs = Date.now() - waitStartedAt;
  if (waitedMs >= 10) {
    console.log(`⏳ EPD push serialization waited ${waitedMs}ms: device=${device.id} endpoint=${key}`);
  }

  try {
    return await fn();
  } finally {
    release();
    if (einkPushTails.get(key) === tail) einkPushTails.delete(key);
  }
}

/**
 * 推送 bitmap 到 E-Ink 设备。中央按物理 endpoint 串行，避免任何调用路径并发打同一板端。
 */
export async function pushToEinkDevice(
  device: EinkDevice,
  bitmap: Buffer,
  options: PushToEinkOptions = {}
): Promise<EinkPushResult> {
  return withEinkDevicePushLock(device, () => pushToEinkDeviceUnlocked(device, bitmap, options));
}

async function pushToEinkDeviceUnlocked(
  device: EinkDevice,
  bitmap: Buffer,
  options: PushToEinkOptions = {}
): Promise<EinkPushResult> {
  const url = `${device.baseUrl.replace(/\/+$/, '')}/display/bitmap`;
  const protocol = device.wireProtocol ?? 'legacy-raw-v0';
  const width = device.width || EINK_WIDTH;
  const height = device.height || EINK_HEIGHT;
  const traceId = protocol === 'epd1-v1' ? normalizeEpdTraceId(options.traceId) : undefined;
  let bodyCrc32: string | undefined;
  let bodyBytes: number | undefined;
  let ackTraceId: string | undefined;
  let ackCrc32: string | undefined;
  let deviceError: unknown;
  let statusSnapshot = options.statusSnapshot;
  console.log(`📤 推送 bitmap 到设备: ${device.name} (${url}, ${protocol}, ${width}x${height})`);

  try {
    if (protocol === 'epd1-v1') {
      statusSnapshot = statusSnapshot ?? await getEinkStatus(device);
      assertEinkStatusMatches(device, statusSnapshot);
    }

    const body = protocol === 'epd1-v1'
      ? buildEpd1Body(bitmap, device)
      : bitmap;
    bodyCrc32 = protocol === 'epd1-v1' ? crc32Hex(body) : undefined;
    bodyBytes = body.length;

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Authorization': `Bearer ${device.token}`,
    };
    if (traceId) headers[EPD_TRACE_HEADER] = traceId;
    if (bodyCrc32) headers[EPD_CRC32_HEADER] = bodyCrc32;

    if (traceId) {
      console.log(`🧭 EPD1 trace=${traceId} crc32=${bodyCrc32} body=${body.length}B device=${device.id}`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(30000)
    });

    ackTraceId = response.headers.get(EPD_TRACE_HEADER) || undefined;
    const echoedTrace = ackTraceId || traceId;
    if (!response.ok) {
      const errorText = await response.text();
      try {
        deviceError = JSON.parse(errorText);
      } catch {
        deviceError = undefined;
      }
      throw new Error(
        `HTTP ${response.status}` +
        `${echoedTrace ? ` trace=${echoedTrace}` : ''}` +
        `${bodyCrc32 ? ` crc32=${bodyCrc32}` : ''}: ${errorText}`
      );
    }

    const result = await response.json() as { ok: boolean; ts?: number; trace_id?: string; crc32?: string };
    ackTraceId = result.trace_id || ackTraceId;
    ackCrc32 = result.crc32;
    const diagV1 = protocol === 'epd1-v1' && (statusSnapshot?.protocol_diag ?? 0) >= 1;
    if (diagV1 && statusSnapshot?.trace_supported && !result.trace_id) {
      throw new Error(`EPD1 ACK trace missing code=ack_trace_missing expect=${traceId ?? '-'}`);
    }
    if (diagV1 && statusSnapshot?.crc32_supported && !result.crc32) {
      throw new Error(`EPD1 ACK CRC missing code=ack_crc_missing trace=${traceId ?? '-'}`);
    }
    if (traceId && result.trace_id && result.trace_id !== traceId) {
      throw new Error(`EPD1 ACK trace mismatch code=ack_trace_mismatch expect=${traceId} got=${result.trace_id}`);
    }
    if (bodyCrc32 && result.crc32 && result.crc32.toLowerCase() !== bodyCrc32) {
      throw new Error(
        `EPD1 ACK CRC mismatch code=ack_crc_mismatch trace=${traceId ?? '-'} ` +
        `expect=${bodyCrc32} got=${result.crc32}`
      );
    }
    const resultTrace = result.trace_id || echoedTrace;
    const resultCrc32 = result.crc32 || bodyCrc32;
    console.log(
      `✅ 设备推送成功: ${device.name}, protocol=${protocol}, body=${body.length}B, ` +
      `trace=${resultTrace ?? '-'}, crc32=${resultCrc32 ?? '-'}, ts=${result.ts ?? '-'}`
    );
    return {
      ...result,
      traceId: resultTrace,
      crc32: resultCrc32,
      requestTraceId: traceId,
      requestCrc32: bodyCrc32,
      bodyBytes,
      ackTraceId,
      ackCrc32,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ 设备推送失败: ${device.name}`, errorMsg);
    return {
      ok: false,
      error: errorMsg,
      traceId,
      crc32: bodyCrc32,
      requestTraceId: traceId,
      requestCrc32: bodyCrc32,
      bodyBytes,
      ackTraceId,
      ackCrc32,
      deviceError,
    };
  }
}

export interface EinkStatus {
  width?: number;
  height?: number;
  colorMode?: string;
  planeCount?: number;
  planeBytes?: number;
  firmware?: string;
  wire_protocol?: string;
  protocol_diag?: number;
  crc32_supported?: boolean;
  trace_supported?: boolean;
  last_push_trace_id?: string;
  last_reject_trace_id?: string;
  last_reject_code?: string;
  stale_body_resets?: number;
  crc_mismatches?: number;
}

/**
 * EPD1 设备自报规格。只在 epd1-v1 推送前调用，旧 C3 裸位图路径不依赖该端点。
 */
export async function getEinkStatus(device: EinkDevice): Promise<EinkStatus> {
  const response = await fetch(`${device.baseUrl.replace(/\/+$/, '')}/status`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`status HTTP ${response.status}`);
  }
  return await response.json() as EinkStatus;
}

/**
 * 解析设备运行时真值。
 *
 * DB 中的 width/height 是登记值，只能作为旧 C3 固件的 fallback；EPD1 设备
 * 必须以板端 /status 为准。这样即使登记配置暂时落后，后续的排版、位图转换
 * 和 EPD1 头仍然使用同一组真实尺寸。
 */
export async function resolveEinkDeviceSpec(device: EinkDevice): Promise<EinkDevice> {
  return (await resolveEinkDeviceSpecWithStatus(device)).device;
}

/**
 * 与 resolveEinkDeviceSpec 相同，但额外交还本次探测到的 /status 快照，
 * 让调用方把它传给 pushToEinkDevice，避免同一链路二次探测（Phase 0 止血①）。
 * legacy 设备没有 /status，快照为 undefined。
 */
export async function resolveEinkDeviceSpecWithStatus(device: EinkDevice): Promise<{
  device: EinkDevice;
  status?: EinkStatus;
}> {
  if ((device.wireProtocol ?? 'legacy-raw-v0') !== 'epd1-v1') return { device };

  const status = await getEinkStatus(device);
  const width = Number.isInteger(status.width) && status.width! > 0 ? status.width! : device.width;
  const height = Number.isInteger(status.height) && status.height! > 0 ? status.height! : device.height;
  const planeCount = Number.isInteger(status.planeCount) && status.planeCount! > 0
    ? status.planeCount!
    : device.planeCount;

  return {
    device: {
      ...device,
      width,
      height,
      planeCount,
    },
    status,
  };
}

/** 由设备运行时规格生成唯一的渲染目标。 */
export async function resolveEinkRenderTarget(device: EinkDevice): Promise<{
  device: EinkDevice;
  target: RenderTarget;
  status?: EinkStatus;
}> {
  const { device: resolvedDevice, status } = await resolveEinkDeviceSpecWithStatus(device);
  return {
    device: resolvedDevice,
    target: createEinkTarget(resolvedDevice.width, resolvedDevice.height),
    status,
  };
}

/** 纯比对：拿已有的 /status 快照校验设备规格，自身不发任何请求。 */
export function assertEinkStatusMatches(device: EinkDevice, status: EinkStatus): void {
  const width = device.width || EINK_WIDTH;
  const height = device.height || EINK_HEIGHT;
  const planeCount = device.planeCount ?? 1;
  const expectedPlaneBytes = Math.ceil(width / 8) * height;
  const gotPlaneBytes = status.planeBytes;

  if (status.width !== width || status.height !== height ||
      (status.planeCount !== undefined && status.planeCount !== planeCount) ||
      (gotPlaneBytes !== undefined && gotPlaneBytes !== expectedPlaneBytes)) {
    throw new Error(
      `设备规格不匹配: 登记=${width}x${height}/planes=${planeCount}/planeBytes=${expectedPlaneBytes}, ` +
      `设备=${status.width ?? '?' }x${status.height ?? '?'}/planes=${status.planeCount ?? '?'}/planeBytes=${gotPlaneBytes ?? '?'}`
    );
  }
}

/**
 * 组装统一内核 eink_protocol.h 对应的 16 字节 PushHeader。
 * 目前服务端先实现黑白单平面；三色需要额外的红色平面输入，不能复用单 bitmap 猜测。
 */
export function buildEpd1Body(bitmap: Buffer, device: EinkDevice): Buffer {
  const width = device.width || EINK_WIDTH;
  const height = device.height || EINK_HEIGHT;
  const colorMode = device.colorMode ?? 'mono-1bit';
  const planeCount = device.planeCount ?? (colorMode === '3-color' ? 2 : 1);
  const planeBytes = Math.ceil(width / 8) * height;

  if (planeCount !== 1 || colorMode !== 'mono-1bit') {
    throw new Error(`当前只支持 epd1-v1 黑白单平面，收到 colorMode=${colorMode}, planeCount=${planeCount}`);
  }
  if (bitmap.length !== planeBytes) {
    throw new Error(`位图大小不匹配: expect ${planeBytes}, got ${bitmap.length}`);
  }

  const body = Buffer.alloc(16 + planeBytes);
  body.write('EPD1', 0, 4, 'ascii');
  body[4] = 1;
  body[5] = 0;
  body[6] = 1;
  body[7] = 0;
  body.writeUInt16LE(width, 8);
  body.writeUInt16LE(height, 10);
  body.writeUInt32LE(planeBytes, 12);
  bitmap.copy(body, 16);
  return body;
}

/**
 * 将 PNG buffer 转换为 1-bit packed bitmap（支持自定义尺寸）
 * @param pngBuffer - 输入 PNG 文件的 buffer
 * @param width - 目标像素宽（默认 EINK_WIDTH）
 * @param height - 目标像素高（默认 EINK_HEIGHT）
 * @returns packed bitmap buffer
 */
export async function pngTo1BitBitmap(pngBuffer: Buffer, width: number = EINK_WIDTH, height: number = EINK_HEIGHT): Promise<Buffer> {
  const bitmapSize = Math.ceil(width / 8) * height;
  const source = sharp(pngBuffer);
  const sourceMeta = await source.metadata();
  const isPointToPoint = sourceMeta.width === width && sourceMeta.height === height;

  // 1. 目标感知渲染应当已经是同尺寸 PNG，此时完全不缩放。
  //    旧历史图/第三方图片尺寸不一致时使用 contain，避免 fit=fill 非等比拉伸；
  //    真正需要不同版式的新闻会在上游按 RenderTarget 重新排版。
  const raw = await source
    .resize(width, height, isPointToPoint
      ? undefined
      : { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();
  // raw 每字节代表一个像素（0 或 255）

  // 2. Pack 成 1-bit MSB-first, 黑像素 (value=0) → bit=1
  const packed = Buffer.alloc(bitmapSize);
  for (let i = 0; i < raw.length; i++) {
    const isBlack = raw[i] < 128;
    if (isBlack) {
      const byteIdx = i >> 3;
      const bitIdx = 7 - (i & 7); // MSB first
      packed[byteIdx] |= (1 << bitIdx);
    }
  }
  return packed;
}

/**
 * 验证 bitmap 大小是否正确
 */
export function validateBitmapSize(buf: Buffer): boolean {
  return buf.length === EINK_BITMAP_SIZE;
}

export const EINK_CONSTANTS = {
  WIDTH: EINK_WIDTH,
  HEIGHT: EINK_HEIGHT,
  BITMAP_SIZE: EINK_BITMAP_SIZE,
};
