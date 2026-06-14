// 设备化输出通道(sink)：按设备 kind 把 PNG 路由到对应硬件通道。
// 放在 api/ 而非 core/：三个 sink 后端(eink-converter/device-pusher)都在 api/，
// 放 core 会造成 core→api 层级倒置；放这里全是 api→core 正向依赖。
import { RenderTarget } from '../react-widgets/core/render-targets.js';
import { niimbotPush } from '../react-widgets/core/niimbot-push-module.js';
import { packFromPng } from '../react-widgets/core/bitmap-packer.js';
import { pushToEinkDevice, pngTo1BitBitmap } from './eink-converter.js';
import { devicePusher } from './device-pusher.js';

export type DeviceKind = 'thermal-printer' | 'eink-local' | 'eink-cloud';

export interface PushDeviceRow {
  id: string;
  name: string;
  base_url: string;
  token: string;
  width: number;
  height: number;
  enabled: boolean;
  kind: DeviceKind;
  capabilities: string[];
}

export interface SinkResult {
  ok: boolean;
  status?: number;
  error?: string;
}

// 统一以 PNG buffer 为输入：niimbot/eink 需 packed bitmap、MindReset 需 PNG 文件，
// 各 sink 内部自己转换，调用方只管给 PNG。
export interface OutputSink {
  kind: DeviceKind;
  send(png: Buffer, device: PushDeviceRow, target: RenderTarget): Promise<SinkResult>;
}

// thermal-printer → niimbot 出贴纸
const niimbotSink: OutputSink = {
  kind: 'thermal-printer',
  async send(png, device, target) {
    const bitmap = await packFromPng(png, target);
    const r = await niimbotPush.push(bitmap, target, device.base_url, {});
    return { ok: r.queued, status: r.status, error: r.error };
  },
};

// eink-local → ESP32 墨水屏屏显
const einkSink: OutputSink = {
  kind: 'eink-local',
  async send(png, device, target) {
    const bitmap = await pngTo1BitBitmap(png, target.widthPx, target.heightPx);
    const r = await pushToEinkDevice(
      {
        id: device.id,
        name: device.name,
        baseUrl: device.base_url,
        token: device.token,
        width: device.width,
        height: device.height,
      },
      bitmap
    );
    return { ok: r.ok, error: r.error };
  },
};

// eink-cloud → MindReset 云屏(走 CLI send-server-dither，需要 PNG 临时文件)
const mindResetSink: OutputSink = {
  kind: 'eink-cloud',
  async send(png, _device, _target) {
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const fs = await import('fs/promises');
    const { randomUUID } = await import('crypto');
    const tmp = join(tmpdir(), `sink_${randomUUID()}.png`);
    await fs.writeFile(tmp, png);
    try {
      const r = await devicePusher.push(tmp, 'device');
      return { ok: r.ok, error: r.error };
    } finally {
      try {
        await fs.unlink(tmp);
      } catch {
        // 忽略清理错误
      }
    }
  },
};

const SINKS: Record<DeviceKind, OutputSink> = {
  'thermal-printer': niimbotSink,
  'eink-local': einkSink,
  'eink-cloud': mindResetSink,
};

export function getSinkForKind(kind: DeviceKind): OutputSink | null {
  return SINKS[kind] ?? null;
}

// 设备 kind ↔ RenderTarget.kind 匹配校验：thermal-printer 只配 thermal-label，
// eink-* 只配 eink。杜绝"尺寸不对硬塞"。
export function deviceKindMatchesTarget(
  deviceKind: DeviceKind,
  targetKind: RenderTarget['kind']
): boolean {
  if (deviceKind === 'thermal-printer') return targetKind === 'thermal-label';
  return targetKind === 'eink';
}
