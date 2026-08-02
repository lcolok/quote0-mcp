/**
 * 设备推送层（Device Pusher）
 * 第一性原理：Renderer 只负责生成图片，Cache 只负责返回元数据，
 * 只有 Pusher 有权触碰物理设备。统一推送入口，彻底消除重复推送。
 */

import * as cp from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';

import type { EinkDevice, EinkStatus } from './eink-converter.js';
import {
  PUSH_CONCURRENCY_LIMIT,
  classifyPushError,
  mapWithConcurrency,
  summarizePushResults,
  type DevicePushResult,
  type PushBatchStatus,
} from './push-results.js';

const execFileAsync = promisify(cp.execFile);

export interface PushResult {
  /**
   * 向后兼容字段：语义为 `status !== 'failure'`，
   * 即“至少一台设备推送成功”（非 local-eink 路径下就是单一成败）。
   * 想区分全成功 / 部分成功请读 `status`。
   */
  ok: boolean;
  deviceResult?: string;
  /** 逐设备结果。旧字段 device/ok/error 保留不变，新增 deviceId/errorCode/durationMs。 */
  pushResults?: DevicePushResult[];
  /** success 全成功 / partial_success 部分成功 / failure 全失败。 */
  status?: PushBatchStatus;
  succeeded?: number;
  failed?: number;
  error?: string;
}

export interface DevicePushOptions {
  /** local-eink 渲染器的目标设备；未提供时推送到全部启用的墨水屏。 */
  deviceIds?: string[];
  /**
   * 调用方已经解析好的设备运行时规格 + /status 快照（Phase 0 止血①）。
   *
   * target-aware 路径为了分组排版已经探过一次 /status，把结果传进来，
   * 推送层就不再重复探测（离线设备每次探测都是 5s 超时）。
   * 提供时完全以此列表为准，不再读 DB/env 设备表。
   */
  preResolvedDevices?: Array<{ device: EinkDevice; status?: EinkStatus }>;
}

export class DevicePusher {
  private retryDelayMs: number;

  constructor(options?: { retryDelayMs?: number }) {
    this.retryDelayMs = options?.retryDelayMs ?? 30000;
  }

  /**
   * 统一推送入口
   * @param imageInput 本地文件路径或 MinIO URL
   * @param renderer   'device' | 'local-eink'
   */
  async push(
    imageInput: string,
    renderer: 'device' | 'local-eink',
    options: DevicePushOptions = {}
  ): Promise<PushResult> {
    let localFilePath: string;
    let isTempFile = false;

    if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
      localFilePath = await this.downloadToTemp(imageInput);
      isTempFile = true;
    } else {
      localFilePath = imageInput;
    }

    try {
      if (renderer === 'local-eink') {
        return await this.pushToLocalEink(localFilePath, options);
      }
      // MindReset（云屏）走单一 CLI 通道，没有逐设备维度，status 只会是 success/failure。
      return await this.pushToMindReset(localFilePath);
    } finally {
      if (isTempFile) {
        try {
          await fs.unlink(localFilePath);
        } catch {
          // 忽略清理错误
        }
      }
    }
  }

  private async downloadToTemp(url: string): Promise<string> {
    // SSRF 防护：只允许 http/https 协议，拒绝内网地址
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http/https 协议');
    }
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.') || hostname.startsWith('169.254.')) {
      throw new Error('禁止访问内网地址');
    }

    const { randomUUID } = await import('crypto');
    const tempFileName = `pusher_${randomUUID()}.png`;
    const tempFilePath = path.join(tmpdir(), tempFileName);

    await new Promise<void>((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      const file = createWriteStream(tempFilePath);

      const request = client.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve());
        });
        file.on('error', (err) => {
          file.close();
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        reject(err);
      });
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('下载超时'));
      });
    });

    return tempFilePath;
  }

  private async pushToMindReset(localFilePath: string): Promise<PushResult> {
    const deviceCommand = `bunx tsx src/image-sender/interfaces/cli/cli-main.ts send-server-dither "${localFilePath}" "0" "" "ORDERED"`;

    let retryCount = 0;
    const maxRetries = 2;
    const baseDelay = 30000;

    while (retryCount <= maxRetries) {
      try {
        const { stdout, stderr } = await execFileAsync('bunx', ['tsx', 'src/image-sender/interfaces/cli/cli-main.ts', 'send-server-dither', localFilePath, '0', '', 'ORDERED'], {
          cwd: process.cwd(),
          env: process.env,
        });

        // stdout/stderr from CLI may contain sensitive data; only log on failure
        if (stderr) console.error('MindReset CLI stderr:', stderr);

        return { ok: true, status: 'success', succeeded: 1, failed: 0, deviceResult: '推送成功' };
      } catch (deviceError: any) {
        if (deviceError.message.includes('429 Too Many Requests') && retryCount < maxRetries) {
          const delay = this.retryDelayMs * (retryCount + 1);
          console.warn(`⏱️ 遇到API频率限制，${delay / 1000}秒后进行第${retryCount + 1}次重试...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          retryCount++;
          continue;
        }

        return { ok: false, status: 'failure', succeeded: 0, failed: 1, error: `推送失败: ${deviceError.message}` };
      }
    }

    return { ok: false, status: 'failure', succeeded: 0, failed: 1, error: '超过最大重试次数' };
  }

  private async pushToLocalEink(localFilePath: string, options: DevicePushOptions = {}): Promise<PushResult> {
    const { pngTo1BitBitmap, getEinkDevices, pushToEinkDevice, resolveEinkDeviceSpecWithStatus } = await import('./eink-converter.js');
    const pngBuffer = await fs.readFile(localFilePath);

    // 调用方已解析过设备（target-aware 路径）就直接用，否则自己查设备表。
    const preResolved = options.preResolvedDevices;
    const devices = preResolved ? preResolved.map((entry) => entry.device) : await getEinkDevices(options);
    if (devices.length === 0) {
      console.warn('⚠️ 未配置 E-Ink 设备，跳过推送');
      return {
        ok: false,
        status: 'failure',
        succeeded: 0,
        failed: 0,
        pushResults: [],
        error: options.deviceIds?.length
          ? `未找到已启用的目标墨水屏: ${options.deviceIds.join(', ')}`
          : '未配置 E-Ink 设备',
      };
    }

    // 止血②：设备间有界并发（上限 4），一台离线设备不再拖完整批。
    // 同一设备在本函数内只出现一次，故不存在对同一设备并发发送。
    const settled = await mapWithConcurrency(devices, PUSH_CONCURRENCY_LIMIT, async (device, index): Promise<DevicePushResult> => {
      const startedAt = Date.now();
      try {
        // EPD1 设备的 /status 是运行时 SSoT；旧 C3 没有该端点，沿用登记尺寸。
        // 止血①：快照只取一次（或直接用调用方传下来的），并传给 pushToEinkDevice 做校验。
        const { device: resolvedDevice, status } = preResolved
          ? preResolved[index]
          : await resolveEinkDeviceSpecWithStatus(device);
        const bitmap = await pngTo1BitBitmap(pngBuffer, resolvedDevice.width, resolvedDevice.height);
        const result = await pushToEinkDevice(resolvedDevice, bitmap, { statusSnapshot: status });
        const durationMs = Date.now() - startedAt;
        if (result.ok) {
          console.log(`✅ ${resolvedDevice.name} (${resolvedDevice.width}x${resolvedDevice.height}) 推送成功 (${durationMs}ms)`);
          return { device: device.id, deviceId: device.id, ok: true, error: undefined, durationMs };
        }
        console.error(`❌ ${resolvedDevice.name} 推送失败: ${result.error}`);
        return {
          device: device.id,
          deviceId: device.id,
          ok: false,
          error: result.error,
          errorCode: classifyPushError(result.error),
          durationMs,
        };
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error(`❌ ${device.name} 转换/推送异常: ${msg}`);
        return {
          device: device.id,
          deviceId: device.id,
          ok: false,
          error: msg,
          errorCode: classifyPushError(e),
          durationMs: Date.now() - startedAt,
        };
      }
    });

    // worker 已全内部 catch，rejected 只可能是意外，仍然降级为逐设备失败而不丢掉。
    const pushResults: DevicePushResult[] = settled.map((entry, index) => {
      if (entry.status === 'fulfilled') return entry.value;
      const reason = entry.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      return {
        device: devices[index].id,
        deviceId: devices[index].id,
        ok: false,
        error: msg,
        errorCode: classifyPushError(reason),
      };
    });

    const summary = summarizePushResults(pushResults);
    return {
      ok: summary.status !== 'failure',
      status: summary.status,
      succeeded: summary.succeeded,
      failed: summary.failed,
      deviceResult: `e-ink 推送完成: ${summary.succeeded}/${pushResults.length} 成功`,
      pushResults,
    };
  }
}

export const devicePusher = new DevicePusher();
