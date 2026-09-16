/**
 * 图像后端存活判定:死模型重映射 + 参考图/原图 URL 存活探测。
 *
 * 会话微调链路里有两类「看着有、实际不可用」的死值:
 *  1) bizyair 系出图模型(sd5/sd5-3k/nb2/nbp/gpt2)上游已关停(生产 503)——
 *     从父版本 params.model 或批次默认值继承来时会把整条链路拖死(连 rewrite 文生图都失败);
 *  2) 历史标签的 source_image_url 指向已关停的 bizyair OSS(404)——
 *     img2img 拿它当底图必败,而只看 NULL 的守卫拦不住。
 */

/** bizyair 系出图模型(与 BizyAirModel 联合类型一致):上游已关停,一律视作死模型 */
export const DEAD_BIZYAIR_MODELS: ReadonlySet<string> = new Set([
  'sd5',
  'sd5-3k',
  'nb2',
  'nbp',
  'gpt2',
]);

/** 死模型统一重映射到的存活默认模型(TuZi,OpenAI images API 兼容,支持文生图 + 图生图) */
export const LIVE_DEFAULT_MODEL = 'tuzi:gpt-image-2.5';

/**
 * 把模型串归一到「当前可执行」的模型:
 *  - 死模型(bizyair 系) → LIVE_DEFAULT_MODEL,并回带原值供溯源;
 *  - 活模型(如 tuzi:gpt-image-2.5) → 原样返回,remappedFrom=null;
 *  - 空值(未指定) → 直接给存活默认模型,remappedFrom=null(没有「原选择」可溯源)。
 */
export function resolveLiveModel(model: string | null | undefined): {
  model: string;
  remappedFrom: string | null;
} {
  if (typeof model !== 'string' || !model.trim()) {
    return { model: LIVE_DEFAULT_MODEL, remappedFrom: null };
  }
  const m = model.trim();
  if (DEAD_BIZYAIR_MODELS.has(m)) return { model: LIVE_DEFAULT_MODEL, remappedFrom: m };
  return { model: m, remappedFrom: null };
}

/** 单次探测并发上限(versions 通常 ≤5,留足余量) */
const PROBE_CONCURRENCY = 8;
/** 单次探测超时 —— 只判存活,不拉内容 */
const PROBE_TIMEOUT_MS = 3000;

/** 2xx/3xx 算活(3xx 视作可达:上游可能只是重定向到 CDN) */
function isAliveStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

/**
 * HEAD 优先;上游不支持 HEAD(405/501)时退回带 Range 的 GET 只取首字节。
 * 网络异常 / 超时 → 算死(fail-closed:宁可不生图,也不入队一个必败的 job)。
 * 非绝对 URL(如相对路径)无网可探 → 不作死判定(避免误删本可用的参考图)。
 */
async function probeOne(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return true;
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return isAliveStatus(get.status);
    }
    return isAliveStatus(head.status);
  } catch {
    return false;
  }
}

/**
 * 并发(限 PROBE_CONCURRENCY)探测一组 URL 的存活状态,返回 url→alive 映射。
 * 输入自动去重;未探测到的 URL 不在映射里(调用方按「非 false 即活」处理)。
 */
export async function probeUrlsAlive(urls: string[]): Promise<Map<string, boolean>> {
  const unique = [
    ...new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0)),
  ];
  const result = new Map<string, boolean>();
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= unique.length) return;
      result.set(unique[i], await probeOne(unique[i]));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, unique.length) }, () => worker())
  );
  return result;
}
