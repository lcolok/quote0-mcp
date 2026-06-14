/**
 * e-ink 图片格式转换器
 * 将 PNG 转换为 1-bit packed bitmap (296×152, MSB-first, 黑像素=1)
 * 格式与 ESP32 GxEPD2 drawBitmap() 严格一致
 */

import sharp from 'sharp';
import { EINK_DEVICE_WIDTH as EINK_WIDTH, EINK_DEVICE_HEIGHT as EINK_HEIGHT } from '../react-widgets/core/device-constants.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';

const EINK_BITMAP_SIZE = (EINK_WIDTH * EINK_HEIGHT) / 8; // 5624

export interface EinkDevice {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
  width?: number;
  height?: number;
}

/**
 * 获取 E-Ink 设备列表
 * 优先从环境变量 EINK_DEVICES_JSON 读取，fallback 到配置文件
 */
export async function getEinkDevices(): Promise<EinkDevice[]> {
  // DB 优先
  try {
    const rows = await getPostgresDatabase().getEnabledPushDevices();
    // 设备化:只取 eink-local 设备。push_devices 现在混装多种 kind(thermal-printer 等),
    // 不过滤会把 niimbot 打印机也当墨水屏,导致 local-eink 推送把 bitmap 误发到打印端点。
    const einkRows = rows.filter(r => r.kind === 'eink-local');
    if (einkRows.length > 0) {
      console.log(`📋 从 DB push_devices 读取 E-Ink 设备列表: ${einkRows.length} 个 eink-local 设备(共 ${rows.length} 台启用)`);
      return einkRows.map(r => ({ id: r.id, name: r.name, baseUrl: r.base_url, token: r.token, width: r.width, height: r.height }));
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
      return devices;
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
    return devices;
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
  console.log(`📤 推送 bitmap 到设备: ${device.name} (${url})`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': `Bearer ${device.token}`
      },
      body: new Uint8Array(bitmap),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { ok: boolean; ts: number };
    console.log(`✅ 设备推送成功: ${device.name}, ts=${result.ts}`);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ 设备推送失败: ${device.name}`, errorMsg);
    return { ok: false, error: errorMsg };
  }
}

/**
 * 将 PNG buffer 转换为 1-bit packed bitmap（支持自定义尺寸）
 * @param pngBuffer - 输入 PNG 文件的 buffer
 * @param width - 目标像素宽（默认 EINK_WIDTH）
 * @param height - 目标像素高（默认 EINK_HEIGHT）
 * @returns packed bitmap buffer
 */
export async function pngTo1BitBitmap(pngBuffer: Buffer, width: number = EINK_WIDTH, height: number = EINK_HEIGHT): Promise<Buffer> {
  const bitmapSize = (width * height) / 8;
  // 1. sharp 加载 PNG → 灰度 → 阈值 128 二值化 → raw 像素
  const raw = await sharp(pngBuffer)
    .resize(width, height, { fit: 'fill' })
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
