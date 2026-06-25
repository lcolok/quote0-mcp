import { thermalLabelRenderer } from './thermal-label-rendering-module.js';
import { niimbotPush } from './niimbot-push-module.js';
import { RenderTarget } from './render-targets.js';
import { LabelData } from '../components/LabelWidget.js';

export interface LabelPrintRequest {
  data: LabelData;
  target: RenderTarget;
  endpoint: string;          // niimbot HTTP endpoint，调用方传入
  timeout?: number;          // push 超时 ms，默认 10000
  printId?: string;          // 可选，默认 render 阶段生成
  /** 打印浓度 1-5，透传给 niimbot 推送。不传则推送模块默认 1。 */
  density?: number;
}

export interface LabelPrintResponse {
  success: boolean;
  printId?: string;
  stage?: 'render' | 'push';     // 失败发生在哪一阶段
  bytes?: number;                // bitmap 字节数（成功时填）
  httpStatus?: number;           // niimbot 返回 HTTP 状态
  error?: string;
}

export class LabelPrintOrchestrator {
  async print(req: LabelPrintRequest): Promise<LabelPrintResponse> {
    // stage 1: render
    let bitmap: Buffer;
    let printId: string;
    let bytes: number;
    try {
      console.log(`📐 渲染标签: title="${req.data.title}"${req.data.subtitle ? ` / subtitle="${req.data.subtitle}"` : ''}`);
      const r = await thermalLabelRenderer.render(req.data, req.target);
      bitmap = r.bitmapBuffer;
      printId = req.printId ?? r.printId;
      bytes = r.bitmapBuffer.length;
      console.log(`✅ 渲染完成: ${bytes} bytes / printId=${printId}`);
    } catch (e: any) {
      const error = e?.message ?? String(e);
      console.error(`❌ 渲染失败: ${error}`);
      return { success: false, stage: 'render', error };
    }

    // stage 2: push
    try {
      console.log(`📤 推送至 ${req.endpoint}`);
      const push = await niimbotPush.push(
        bitmap,
        req.target,
        req.endpoint,
        { timeoutMs: req.timeout ?? 10000, printId, density: req.density }
      );
      if (!push.queued) {
        console.error(`❌ 推送失败: HTTP ${push.status ?? '?'} - ${push.error ?? 'unknown'}`);
        return { success: false, stage: 'push', printId, httpStatus: push.status, error: push.error };
      }
      console.log(`✅ 已入队: HTTP ${push.status}`);
      return { success: true, printId, bytes, httpStatus: push.status };
    } catch (e: any) {
      const error = e?.message ?? String(e);
      console.error(`❌ 推送异常: ${error}`);
      return { success: false, stage: 'push', printId, error };
    }
  }
}

export const labelPrintOrchestrator = new LabelPrintOrchestrator();
