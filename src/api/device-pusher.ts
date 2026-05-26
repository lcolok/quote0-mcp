/**
 * 设备推送层（Device Pusher）
 * 第一性原理：Renderer 只负责生成图片，Cache 只负责返回元数据，
 * 只有 Pusher 有权触碰物理设备。统一推送入口，彻底消除重复推送。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';

const execAsync = promisify(exec);

export interface PushResult {
  ok: boolean;
  deviceResult?: string;
  pushResults?: Array<{ device: string; ok: boolean; error?: string }>;
  error?: string;
}

export class DevicePusher {
  /**
   * 统一推送入口
   * @param imageInput 本地文件路径或 MinIO URL
   * @param renderer   'device' | 'local-eink'
   */
  async push(imageInput: string, renderer: 'device' | 'local-eink'): Promise<PushResult> {
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
        return await this.pushToLocalEink(localFilePath);
      }
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
    const tempFileName = `pusher_${Date.now()}.png`;
    const tempFilePath = path.join(tmpdir(), tempFileName);

    await new Promise<void>((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      const file = createWriteStream(tempFilePath);

      client.get(url, (response) => {
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
        const { stdout, stderr } = await execAsync(deviceCommand, {
          cwd: process.cwd(),
          env: process.env,
        });

        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);

        return { ok: true, deviceResult: '推送成功' };
      } catch (deviceError: any) {
        if (deviceError.message.includes('429 Too Many Requests') && retryCount < maxRetries) {
          const delay = baseDelay * (retryCount + 1);
          console.warn(`⏱️ 遇到API频率限制，${delay / 1000}秒后进行第${retryCount + 1}次重试...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          retryCount++;
          continue;
        }

        return { ok: false, error: `推送失败: ${deviceError.message}` };
      }
    }

    return { ok: false, error: '超过最大重试次数' };
  }

  private async pushToLocalEink(localFilePath: string): Promise<PushResult> {
    const { pngTo1BitBitmap, getEinkDevices, pushToEinkDevice } = await import('./eink-converter.js');
    const pngBuffer = await fs.readFile(localFilePath);
    const bitmap = await pngTo1BitBitmap(pngBuffer);
    console.log(`📐 Bitmap 转换完成: ${bitmap.length} bytes`);

    const devices = await getEinkDevices();
    if (devices.length === 0) {
      console.warn('⚠️ 未配置 E-Ink 设备，跳过推送');
      return { ok: false, error: '未配置 E-Ink 设备' };
    }

    const pushResults: Array<{ device: string; ok: boolean; error?: string }> = [];
    for (const device of devices) {
      const result = await pushToEinkDevice(device, bitmap);
      pushResults.push({ device: device.id, ok: result.ok, error: result.error });
      if (result.ok) {
        console.log(`✅ ${device.name} 推送成功`);
      } else {
        console.error(`❌ ${device.name} 推送失败: ${result.error}`);
      }
    }

    const okCount = pushResults.filter((r) => r.ok).length;
    return {
      ok: okCount > 0,
      deviceResult: `e-ink 推送完成: ${okCount}/${pushResults.length} 成功`,
      pushResults,
    };
  }
}

export const devicePusher = new DevicePusher();
