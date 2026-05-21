import { textLabelGenerator } from './text-label-generator.js';
import { EINK_TARGET } from '../core/render-targets.js';
import { getActiveLLMConfig } from '../core/llm-config.js';
import { getPostgresDatabase } from '../core/postgres-database.js';
import { getImageStorage } from '../core/image-storage.js';
import type { TextLabelOverride } from './text-label-generator.js';

const imageStorage = getImageStorage();
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'quote0-images';

export interface MemoRenderResult {
  pngPath: string;
  widgetId: string;
  fontFamily: string;
  latencyMs: number;
}

/**
 * 把一条备忘文字渲染成 E-ink PNG，上传到 MinIO。
 * 复用 textLabelGenerator + LLM 配置，但不依赖 labels 系统。
 */
export async function renderMemoToEink(
  text: string,
  memoId: string,
  override?: TextLabelOverride
): Promise<MemoRenderResult> {
  const db = getPostgresDatabase();
  const llmConfig = await getActiveLLMConfig(db);

  const t0 = Date.now();
  const result = await textLabelGenerator.generate(text, EINK_TARGET, llmConfig, override);
  const latencyMs = Date.now() - t0;

  const pngPath = `memos/${memoId}.png`;
  await imageStorage.getClient().putObject(
    MINIO_BUCKET,
    pngPath,
    result.pngBuffer,
    result.pngBuffer.length,
    {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    }
  );

  return {
    pngPath,
    widgetId: result.widgetId,
    fontFamily: result.fontFamily,
    latencyMs,
  };
}
