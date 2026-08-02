import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import { renderingRegistry } from '../react-widgets/core/rendering-modules.js';
import { devicePusher } from './device-pusher.js';
import {
  getEinkDevices,
  resolveEinkRenderTarget,
  type EinkDevice,
  type EinkStatus,
} from './eink-converter.js';
import {
  PUSH_CONCURRENCY_LIMIT,
  classifyPushError,
  mapWithConcurrency,
  summarizePushResults,
  type DevicePushResult,
  type PushBatchStatus,
} from './push-results.js';

export interface TargetAwareEinkPushResult {
  /**
   * 向后兼容字段：语义为 `status !== 'failure'`，即“至少一台设备推送成功”。
   * 想区分全成功 / 部分成功请读 `status`。
   */
  ok: boolean;
  deviceResult: string;
  /** 逐设备结果。旧字段 device/ok/error 保留不变，新增 deviceId/errorCode/durationMs。 */
  pushResults: DevicePushResult[];
  /** success 全成功 / partial_success 部分成功 / failure 全部失败（含零设备可推）。 */
  status: PushBatchStatus;
  succeeded: number;
  failed: number;
  renderedImages: Array<{
    targetId: string;
    width: number;
    height: number;
    imageUrl?: string;
    localImagePath?: string;
    deviceIds: string[];
  }>;
}

interface ResolvedDeviceEntry {
  device: EinkDevice;
  status?: EinkStatus;
  target: Awaited<ReturnType<typeof resolveEinkRenderTarget>>['target'];
}

/**
 * 按设备运行时 target 分组，分别排版 PNG，再定向推送。
 *
 * 这是新闻数据到本地墨水屏的唯一目标感知入口：
 * data → RenderTarget → Satori PNG → 1-bit bitmap → EPD1/legacy push。
 *
 * Phase 0 止血约束：
 * ① 每台设备在本次调用中只探测一次 /status（resolve 拿到的快照随发送一路传下去）；
 * ② 渲染仍按 target 分组只做一次、同规格设备共享 PNG，只有“发送”环节并发（全局上限 4）；
 * ③ 返回逐设备结果 + 汇总状态，不再 every() 抹平。
 */
export async function renderAndPushLocalEinkByTarget(
  data: RenderableDataItem,
  deviceIds?: string[],
): Promise<TargetAwareEinkPushResult> {
  const localEinkRenderer = renderingRegistry.get('local-eink');
  if (!localEinkRenderer) throw new Error('渲染器 local-eink 不存在');

  const devices = await getEinkDevices({ deviceIds });
  if (devices.length === 0) {
    throw new Error(deviceIds?.length
      ? `未找到已启用的目标墨水屏: ${deviceIds.join(', ')}`
      : '未配置 E-Ink 设备');
  }

  const pushResults: DevicePushResult[] = [];

  // 1. 解析每台设备的运行时规格。这是本次链路中唯一一次 /status 探测；
  //    并发执行，避免离线设备的 5s 超时串行叠加。单台解析失败只记该台，
  //    不影响其余设备继续排版推送。
  const resolveSettled = await mapWithConcurrency(devices, PUSH_CONCURRENCY_LIMIT, async (device) => {
    const { device: resolvedDevice, target, status } = await resolveEinkRenderTarget(device);
    return { device: resolvedDevice, target, status } as ResolvedDeviceEntry;
  });

  const resolved: ResolvedDeviceEntry[] = [];
  resolveSettled.forEach((entry, index) => {
    if (entry.status === 'fulfilled') {
      resolved.push(entry.value);
      const { device, target } = entry.value;
      console.log(`🎯 目标感知推送: ${device.name} → ${target.id} (${target.widthPx}x${target.heightPx})`);
      return;
    }
    const reason = entry.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const device = devices[index];
    console.error(`❌ ${device.name} 运行时规格解析失败: ${message}`);
    pushResults.push({
      device: device.id,
      deviceId: device.id,
      ok: false,
      error: message,
      errorCode: classifyPushError(reason),
    });
  });

  // 2. 按 target 规格分组渲染，同规格设备共享一张 PNG（渲染每组仅一次）。
  const groups = new Map<string, { target: ResolvedDeviceEntry['target']; entries: ResolvedDeviceEntry[] }>();
  for (const entry of resolved) {
    const key = `${entry.target.widthPx}x${entry.target.heightPx}:${entry.target.colorMode}`;
    const group = groups.get(key) ?? { target: entry.target, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }

  const renderedImages: TargetAwareEinkPushResult['renderedImages'] = [];
  const sendTasks: Array<{ entry: ResolvedDeviceEntry; pusherInput: string }> = [];

  for (const group of groups.values()) {
    const groupDeviceIds = group.entries.map((entry) => entry.device.id);
    try {
      const renderResult: any = await localEinkRenderer.render(data, {
        border: '0',
        target: group.target,
        width: group.target.widthPx,
        height: group.target.heightPx,
      });
      renderedImages.push({
        targetId: group.target.id,
        width: group.target.widthPx,
        height: group.target.heightPx,
        imageUrl: renderResult.imageUrl,
        localImagePath: renderResult.localImagePath,
        deviceIds: [...groupDeviceIds],
      });
      const pusherInput = renderResult.localImagePath || renderResult.imageUrl;
      for (const entry of group.entries) sendTasks.push({ entry, pusherInput });
    } catch (error) {
      // 渲染失败是整组共有的失败（同规格共享 PNG），逐台记账，不牵连其他组。
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ 目标 ${group.target.id} 渲染失败: ${message}`);
      for (const deviceId of groupDeviceIds) {
        pushResults.push({
          device: deviceId,
          deviceId,
          ok: false,
          error: message,
          errorCode: classifyPushError(error),
        });
      }
    }
  }

  // 3. 只并发“发送”环节：每个 task 对应恰好一台设备，同一设备在 sendTasks
  //    中至多出现一次 → 天然不存在对同一设备的并发发送。上限 4。
  const sendSettled = await mapWithConcurrency(sendTasks, PUSH_CONCURRENCY_LIMIT, async ({ entry, pusherInput }): Promise<DevicePushResult> => {
    const { device, status } = entry;
    const startedAt = Date.now();
    // 复用第 1 步的 /status 快照 → 推送层零二次探测（止血①）。
    const pushResult = await devicePusher.push(pusherInput, 'local-eink', {
      deviceIds: [device.id],
      preResolvedDevices: [{ device, status }],
    });
    const durationMs = Date.now() - startedAt;
    const perDevice = pushResult.pushResults?.[0];
    if (perDevice) return { ...perDevice, durationMs: perDevice.durationMs ?? durationMs };
    return {
      device: device.id,
      deviceId: device.id,
      ok: pushResult.ok,
      error: pushResult.error,
      errorCode: pushResult.ok ? undefined : classifyPushError(pushResult.error),
      durationMs,
    };
  });

  sendSettled.forEach((entry, index) => {
    if (entry.status === 'fulfilled') {
      pushResults.push(entry.value);
      return;
    }
    const reason = entry.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const deviceId = sendTasks[index].entry.device.id;
    pushResults.push({
      device: deviceId,
      deviceId,
      ok: false,
      error: message,
      errorCode: classifyPushError(reason),
    });
  });

  const summary = summarizePushResults(pushResults);
  return {
    ok: summary.status !== 'failure',
    status: summary.status,
    succeeded: summary.succeeded,
    failed: summary.failed,
    deviceResult: `按目标渲染并推送: ${summary.succeeded}/${pushResults.length} 成功`,
    pushResults,
    renderedImages,
  };
}
