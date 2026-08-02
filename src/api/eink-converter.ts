/**
 * e-ink 图片格式转换器与推送协议适配层。
 * 位图本身仍是 MSB-first、bit=1 表示黑；设备协议由 wireProtocol 决定：
 * - legacy-raw-v0：C3 早期固件，body 只有裸位图
 * - epd1-v1：统一内核，body = 16B EPD1 PushHeader + 平面
 */

import sharp from 'sharp';
import { EINK_DEVICE_WIDTH as EINK_WIDTH, EINK_DEVICE_HEIGHT as EINK_HEIGHT } from '../react-widgets/core/device-constants.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { createEinkTarget, type RenderTarget } from '../react-widgets/core/render-targets.js';

const EINK_BITMAP_SIZE = (EINK_WIDTH * EINK_HEIGHT) / 8; // 5624

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

/**
 * 推送 bitmap 到 E-Ink 设备
 */
export async function pushToEinkDevice(
  device: EinkDevice,
  bitmap: Buffer
): Promise<{ ok: boolean; ts?: number; error?: string }> {
  const url = `${device.baseUrl}/display/bitmap`;
  const protocol = device.wireProtocol ?? 'legacy-raw-v0';
  const width = device.width || EINK_WIDTH;
  const height = device.height || EINK_HEIGHT;
  console.log(`📤 推送 bitmap 到设备: ${device.name} (${url}, ${protocol}, ${width}x${height})`);

  try {
    if (protocol === 'epd1-v1') {
      await verifyEinkStatus(device);
    }

    const body = protocol === 'epd1-v1'
      ? buildEpd1Body(bitmap, device)
      : bitmap;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': `Bearer ${device.token}`
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { ok: boolean; ts: number };
    console.log(`✅ 设备推送成功: ${device.name}, protocol=${protocol}, body=${body.length}B, ts=${result.ts ?? '-'}`);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ 设备推送失败: ${device.name}`, errorMsg);
    return { ok: false, error: errorMsg };
  }
}

export interface EinkStatus {
  width?: number;
  height?: number;
  colorMode?: string;
  planeCount?: number;
  planeBytes?: number;
  firmware?: string;
}

/**
 * EPD1 设备自报规格。只在 epd1-v1 推送前调用，旧 C3 裸位图路径不依赖该端点。
 */
export async function getEinkStatus(device: EinkDevice): Promise<EinkStatus> {
  const response = await fetch(`${device.baseUrl}/status`, {
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
  if ((device.wireProtocol ?? 'legacy-raw-v0') !== 'epd1-v1') return device;

  const status = await getEinkStatus(device);
  const width = Number.isInteger(status.width) && status.width! > 0 ? status.width! : device.width;
  const height = Number.isInteger(status.height) && status.height! > 0 ? status.height! : device.height;
  const planeCount = Number.isInteger(status.planeCount) && status.planeCount! > 0
    ? status.planeCount!
    : device.planeCount;

  return {
    ...device,
    width,
    height,
    planeCount,
  };
}

/** 由设备运行时规格生成唯一的渲染目标。 */
export async function resolveEinkRenderTarget(device: EinkDevice): Promise<{
  device: EinkDevice;
  target: RenderTarget;
}> {
  const resolvedDevice = await resolveEinkDeviceSpec(device);
  return {
    device: resolvedDevice,
    target: createEinkTarget(resolvedDevice.width, resolvedDevice.height),
  };
}

async function verifyEinkStatus(device: EinkDevice): Promise<void> {
  const status = await getEinkStatus(device);
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
