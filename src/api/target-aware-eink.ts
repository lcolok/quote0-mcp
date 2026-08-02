import type { RenderableDataItem } from '../react-widgets/core/modular-architecture.js';
import { renderingRegistry } from '../react-widgets/core/rendering-modules.js';
import { devicePusher } from './device-pusher.js';
import { getEinkDevices, resolveEinkRenderTarget } from './eink-converter.js';

export interface TargetAwareEinkPushResult {
  ok: boolean;
  deviceResult: string;
  pushResults: Array<{ device: string; ok: boolean; error?: string }>;
  renderedImages: Array<{
    targetId: string;
    width: number;
    height: number;
    imageUrl?: string;
    localImagePath?: string;
    deviceIds: string[];
  }>;
}

/**
 * 按设备运行时 target 分组，分别排版 PNG，再定向推送。
 *
 * 这是新闻数据到本地墨水屏的唯一目标感知入口：
 * data → RenderTarget → Satori PNG → 1-bit bitmap → EPD1/legacy push。
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

  const groups = new Map<string, {
    target: Awaited<ReturnType<typeof resolveEinkRenderTarget>>['target'];
    deviceIds: string[];
  }>();

  for (const device of devices) {
    const { target } = await resolveEinkRenderTarget(device);
    const key = `${target.widthPx}x${target.heightPx}:${target.colorMode}`;
    const group = groups.get(key) ?? { target, deviceIds: [] };
    group.deviceIds.push(device.id);
    groups.set(key, group);
    console.log(`🎯 目标感知推送: ${device.name} → ${target.id} (${target.widthPx}x${target.heightPx})`);
  }

  const pushResults: Array<{ device: string; ok: boolean; error?: string }> = [];
  const renderedImages: TargetAwareEinkPushResult['renderedImages'] = [];
  for (const group of groups.values()) {
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
        deviceIds: [...group.deviceIds],
      });
      const pusherInput = renderResult.localImagePath || renderResult.imageUrl;
      const pushResult = await devicePusher.push(
        pusherInput,
        'local-eink',
        { deviceIds: group.deviceIds },
      );

      if (pushResult.pushResults) pushResults.push(...pushResult.pushResults);
      else {
        for (const deviceId of group.deviceIds) {
          pushResults.push({ device: deviceId, ok: pushResult.ok, error: pushResult.error });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const deviceId of group.deviceIds) {
        pushResults.push({ device: deviceId, ok: false, error: message });
      }
    }
  }

  const ok = pushResults.length > 0 && pushResults.every((result) => result.ok);
  return {
    ok,
    deviceResult: `按目标渲染并推送: ${pushResults.filter((result) => result.ok).length}/${pushResults.length} 成功`,
    pushResults,
    renderedImages,
  };
}
