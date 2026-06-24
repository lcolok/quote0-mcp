/**
 * niimbot 网关 HTTP client。调用 192.168.31.186 上的 ESP32 网关，
 * 查询当前装载标签的 RFID 信息 + 设备状态 + 标签规格。
 *
 * gateway 实现位于另一个 repo (esp32-health-station)，本 client 是只读消费方。
 */

import { dpiForDeviceType, mmToWidthPx, mmToHeightPx } from '../core/device-dpi.js';

const NIIMBOT_TIMEOUT_MS = 3000;       // 3s 单请求超时（gateway 在 LAN 内，应该秒回）
const CLOUD_LOOKUP_TIMEOUT_MS = 8000;  // 云反查给长一点（去外网）

export interface NiimbotDeviceInfo {
  deviceType: number;     // 775 = B21
  serial: string;
  swVersion: string;
  hwVersion: string;
  battery: number;        // 0-4 (4 = full)
  density: number;        // 1-5 打印浓度
  labelType: number;
}

export interface NiimbotRfidInfo {
  barcode: string;
  uuid: string;
  serial: string;
  totalMm: number;
  usedMm: number;
  type: number;
}

export interface NiimbotSpec {
  bc: string;
  w: number;    // mm
  h: number;    // mm
  sku: string;
  isCable?: boolean;
  cableLen?: number;
}

export interface CurrentLabelInfo {
  device: NiimbotDeviceInfo | null;
  rfid: NiimbotRfidInfo;
  spec: NiimbotSpec;
  widthPx: number;    // 按 device_type DPI 从 mm 换算（B21 203dpi / B1 Pro 300dpi）
  heightPx: number;
  source: 'spec-local' | 'spec-cloud';
}

export class NiimbotClient {
  /**
   * 上次成功读到的设备信息缓存。
   * C3 的 /api/info 每次都现场向 B1 Pro 发起 BLE 读取，约半数会超时/返回 null，
   * 导致 getDeviceInfo 间歇性拿不到 device_type，进而让 current-target / 打印派生
   * 退回 203dpi 默认值（机型 Unknown、打印尺寸算错）。这里缓存最近一次成功值，
   * 现场失败时回退到它，消除界面闪烁与打错尺寸的风险。设备热插拔后会被下次成功读取覆盖。
   */
  private lastDeviceInfo: NiimbotDeviceInfo | null = null;

  /** 上次成功读到的 RFID 信息缓存（同 lastDeviceInfo，现场读失败时回退，避免卡片整体翻离线） */
  private lastRfid: NiimbotRfidInfo | null = null;

  /**
   * C3 网关访问串行锁。
   * B1 Pro 是单 BLE 连接，C3 每个 /api/info、/api/rfid 都现场发起 BLE GATT 读取；
   * 一旦两个读并发（如 queryCurrentLabel 的 Promise.all、或 current-target 与
   * preview-dither-batch 两端点同时挂载），单连接扛不住并发 → status=13 断连 → 全部失败。
   * 这里把所有网关读串行排队，任意时刻只有一个 BLE 读在途，杜绝自造并发。
   */
  private gatewayChain: Promise<unknown> = Promise.resolve();
  private serializeGateway<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gatewayChain.then(fn, fn);
    // 链尾吞掉成败，保证后续任务不被前一个的 reject 阻断
    this.gatewayChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 从 NIIMBOT_ENDPOINT (含 /api/print/raw) 推导 base URL */
  private getBaseUrl(): string | null {
    const ep = process.env.NIIMBOT_ENDPOINT;
    if (!ep) return null;
    return ep.replace(/\/api\/print\/raw\/?$/, '');
  }

  async getDeviceInfo(): Promise<NiimbotDeviceInfo | null> {
    const base = this.getBaseUrl();
    if (!base) return this.lastDeviceInfo;
    return this.serializeGateway(async () => {
      try {
        const r = await fetch(`${base}/api/info`, {
          signal: AbortSignal.timeout(NIIMBOT_TIMEOUT_MS),
        });
        if (!r.ok) return this.lastDeviceInfo;
        const d: any = await r.json();
        // C3 BLE 读取失败时会返回 null 或缺 device_type，此时回退缓存
        if (!d || d.device_type == null) return this.lastDeviceInfo;
        const info: NiimbotDeviceInfo = {
          deviceType: d.device_type,
          serial: d.serial,
          swVersion: d.sw_version,
          hwVersion: d.hw_version,
          battery: d.battery,
          density: d.density,
          labelType: d.label_type,
        };
        this.lastDeviceInfo = info; // 记录最近一次成功值
        return info;
      } catch (e) {
        console.warn('[niimbot] getDeviceInfo failed:', e instanceof Error ? e.message : e);
        return this.lastDeviceInfo;
      }
    });
  }

  async getRfid(): Promise<NiimbotRfidInfo | null> {
    const base = this.getBaseUrl();
    if (!base) return this.lastRfid;
    return this.serializeGateway(async () => {
      try {
        const r = await fetch(`${base}/api/rfid`, {
          signal: AbortSignal.timeout(NIIMBOT_TIMEOUT_MS),
        });
        if (!r.ok) return this.lastRfid;
        const d: any = await r.json();
        // C3 BLE 读取失败时可能返回 null 或缺 barcode，此时回退缓存
        if (!d || !d.barcode) return this.lastRfid;
        // 注意：gateway 返回字段 total/used (mm)，本 client 字段名加 Mm 后缀更明确
        const info: NiimbotRfidInfo = {
          barcode: d.barcode,
          uuid: d.uuid,
          serial: d.serial,
          totalMm: d.total,
          usedMm: d.used,
          type: d.type,
        };
        this.lastRfid = info; // 记录最近一次成功值
        return info;
      } catch (e) {
        console.warn('[niimbot] getRfid failed:', e instanceof Error ? e.message : e);
        return this.lastRfid;
      }
    });
  }

  /** 本地规格库查询（走 C3 /api/specs，非 BLE，但仍串行化避免与 BLE 读在 C3 上撞车） */
  async getLocalSpec(barcode: string): Promise<NiimbotSpec | null> {
    const base = this.getBaseUrl();
    if (!base) return null;
    return this.serializeGateway(async () => {
    try {
      const r = await fetch(`${base}/api/specs`, {
        signal: AbortSignal.timeout(NIIMBOT_TIMEOUT_MS),
      });
      if (!r.ok) return null;
      const list: any[] = await r.json();
      const match = list.find((s) => s.bc === barcode);
      if (!match) return null;
      return {
        bc: match.bc,
        w: match.w,
        h: match.h,
        sku: match.sku,
        isCable: match.is_cable,
        cableLen: match.cable_len,
      };
    } catch (e) {
      console.warn('[niimbot] getLocalSpec failed:', e instanceof Error ? e.message : e);
      return null;
    }
    });
  }

  /** 云反查（spec 库没数据时回退） */
  async getCloudSpec(barcode: string): Promise<NiimbotSpec | null> {
    const base = this.getBaseUrl();
    if (!base) return null;
    try {
      const r = await fetch(`${base}/api/cloud-lookup?ean=${encodeURIComponent(barcode)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(CLOUD_LOOKUP_TIMEOUT_MS),
      });
      if (!r.ok) return null;
      const d: any = await r.json();
      // 响应字段未文档化，保守解析（可能字段 w/h 或 width/height）
      const w = d.w ?? d.width;
      const h = d.h ?? d.height;
      if (typeof w !== 'number' || typeof h !== 'number') return null;
      return {
        bc: barcode,
        w,
        h,
        sku: d.sku ?? d.name ?? '',
      };
    } catch (e) {
      console.warn('[niimbot] getCloudSpec failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  /**
   * 一次性获取当前装载标签的完整信息。
   * 任何一步失败都返回 null（让调用者 fallback 到默认 target）。
   */
  async queryCurrentLabel(): Promise<CurrentLabelInfo | null> {
    const base = this.getBaseUrl();
    if (!base) return null;

    // 顺序读，绝不并发：两个 BLE 读同时打给 C3 会撑爆 B1 Pro 单连接致 status=13 断连。
    // （getDeviceInfo/getRfid 内部也都过串行锁，这里顺序写法更直白）
    const device = await this.getDeviceInfo();
    const rfid = await this.getRfid();
    if (!rfid || !rfid.barcode) return null;

    // 先本地，后云反查
    let spec = await this.getLocalSpec(rfid.barcode);
    let source: 'spec-local' | 'spec-cloud' = 'spec-local';
    if (!spec) {
      spec = await this.getCloudSpec(rfid.barcode);
      source = 'spec-cloud';
    }
    if (!spec) return null;

    const dpi = dpiForDeviceType(device?.deviceType);
    return {
      device,
      rfid,
      spec,
      widthPx: mmToWidthPx(spec.w, dpi),
      heightPx: mmToHeightPx(spec.h, dpi),
      source,
    };
  }
}

export const niimbotClient = new NiimbotClient();
