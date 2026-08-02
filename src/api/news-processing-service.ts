import { createHash } from 'crypto';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../react-widgets/core/device-constants.js';
import { modularNewsPlugin } from '../react-widgets/plugins/modular-news-plugin.js';
import { stagedCacheManager } from '../react-widgets/core/staged-cache-manager.js';
import { devicePusher } from './device-pusher.js';
import { renderAndPushLocalEinkByTarget } from './target-aware-eink.js';
import type { NewsData } from '../react-widgets/components/NewsWidget.js';
import type {
  FullNewsProcessingResult,
  NewsProcessRequest,
  NewsProcessingConfig,
  NewsProcessingParams,
  NewsPushContext
} from './news-types.js';

const DEBUG = process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'production';
function debugLog(...args: any[]) {
  if (DEBUG) console.log(...args);
}

export async function processNews(body: NewsProcessRequest): Promise<FullNewsProcessingResult> {
  const startTime = Date.now();

  debugLog('🚀 新闻处理任务开始:', body);

  const params: NewsProcessingParams = {
    category: body.category || 'technology',
    dataSource: body.dataSource || 'mock',
    processor: body.processor || 'passthrough',
    renderer: body.renderer || 'news',
    index: body.index ?? 0,
    rssSource: body.rssSource || 'solidot',
    force: body.options?.force ?? false,
    mockData: body.mockData
  };

  const config: NewsProcessingConfig = {
    border: (body.options?.border || '0') as '0' | '1',
    // 设备真实分辨率 296×152（v1.0.22 起 satori widget 统一按此渲染）
    width: body.options?.width || EINK_DEVICE_WIDTH,
    height: body.options?.height || EINK_DEVICE_HEIGHT
  };

  debugLog('📋 处理参数:', params);
  debugLog('⚙️ 配置:', config);

  if (!modularNewsPlugin.validateParams(params)) {
    throw new Error('参数验证失败');
  }

  if (!modularNewsPlugin.validateConfig(config)) {
    throw new Error('配置验证失败');
  }

  const cacheKey = {
    source: `${params.dataSource}_${params.rssSource}`,
    category: params.category,
    index: params.index,
    extra: {
      processor: params.processor,
      renderer: params.renderer,
      config: config
    }
  };

  debugLog('🔍 检查缓存，缓存键:', cacheKey);

  const context: NewsPushContext = {
    category: params.category,
    source: params.rssSource,
    rawIndex: params.index,
    ...body.context
  };

  try {
    await stagedCacheManager.initialize();
  } catch (error) {
    console.warn('⚠️ 缓存系统初始化失败，使用直接处理:', error);
  }

  let result: any;
  let cacheHit = false;
  let cacheSource = 'none';

  const cacheInternals = stagedCacheManager as unknown as {
    postgres?: {
      getCachedImage?: (cacheKey: string) => Promise<{ url: string; objectKey: string } | null>;
      setCachedImage?: (info: {
        cacheKey: string;
        bucketName: string;
        objectKey: string;
        objectSize: number;
        contentType: string;
        etag: string;
        widgetType: string;
        renderConfig: Record<string, unknown>;
        ttl: number;
      }) => Promise<void>;
    };
    config?: {
      imageCacheTTL: number;
    };
  };

  if (!params.force && (params.renderer === 'json' || params.renderer === 'device' || params.renderer === 'local-eink')) {
    try {
      if (params.renderer === 'json') {
        debugLog('🔍 JSON渲染器 - 检查数据缓存...');

        const newsResult = await stagedCacheManager.getOrCacheNewsData(
          cacheKey,
          async () => {
            debugLog('🔄 缓存未命中，执行完整的JSON处理流程...');
            return (await modularNewsPlugin.getData(params)) as unknown as NewsData;
          },
          params.force
        );

        result = newsResult.data;
        cacheHit = newsResult.source !== 'original';
        cacheSource = newsResult.source;
      } else if (params.renderer === 'device' || params.renderer === 'local-eink') {
        debugLog(`📱 设备推送渲染器 (${params.renderer}) - 启用MinIO直接缓存...`);

        let newsFingerprint: string;
        let cachedTextData: any = null;
        let renderResult: Record<string, any> | null = null;

        let usedContextForFingerprint = false;

        if (context.title || context.link || context.publishTime || context.fingerprint) {
          // 调度器会传入完整上下文，优先利用现有数据避免再次执行JSON流程
          debugLog('🧾 使用传入上下文计算fingerprint，跳过额外的JSON流程');
          newsFingerprint = context.fingerprint ?? computeNewsFingerprint({
            title: context.title,
            link: context.link,
            publishTime: context.publishTime,
            source: context.source,
            category: context.category,
            fallback: `${params.dataSource}:${params.rssSource}:${params.index}`
          });
          usedContextForFingerprint = true;
        } else {
          // 若无上下文可用（例如手动API调用），回退到一次性JSON流程
          debugLog('📝 未提供上下文，执行一次JSON流程用于fingerprint计算...');
          const jsonParams = { ...params, processor: 'passthrough' as const, renderer: 'json' as const };
          const jsonResult = await modularNewsPlugin.getData(jsonParams);
          const jsonData = jsonResult as any;

          newsFingerprint = jsonData?.fingerprint ||
                            jsonData?.metadata?.fingerprint ||
                            computeNewsFingerprint({
                              title: jsonData?.title || '',
                              link: jsonData?.link || '',
                              publishTime: jsonData?.publishTime || '',
                              source: jsonData?.source || '',
                              category: jsonData?.category || params.category,
                              fallback: `${params.dataSource}:${params.rssSource}:${params.index}`
                            });

          // 同步上下文，避免后续流程继续缺失元数据
          if (jsonData) {
            context.title = context.title || jsonData.title;
            context.link = context.link || jsonData.link;
            context.publishTime = context.publishTime || jsonData.publishTime;
            context.source = context.source || jsonData.source;
            context.category = context.category || jsonData.category;
            context.fingerprint = newsFingerprint;
          }
        }

        if (!context.fingerprint && usedContextForFingerprint) {
          context.fingerprint = newsFingerprint;
        }

        const cacheKeyString = `${params.dataSource}_${params.rssSource}_${params.processor}_${params.category}_${newsFingerprint}`;
        debugLog(`🔑 生成缓存键（含fingerprint）: ${cacheKeyString}`);

        let imageUrl = '';
        let dbImagePath: string | undefined = undefined;
        let localCacheHit = false;

        // local-eink 不复用默认尺寸图片缓存：它必须从处理后的文本数据
        // 按运行时 RenderTarget 重新排版。
        if (!params.force && params.renderer !== 'local-eink') {
          try {
            debugLog('🔍 检查MinIO中的缓存图片...');

            const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
            const imageStorage = getImageStorage();

            let existsResult: { url: string; objectKey?: string } | null = null;

            try {
              const postgres = cacheInternals.postgres;
              if (postgres?.getCachedImage) {
                const cachedImageInfo: any = await postgres.getCachedImage(cacheKeyString);
                if (cachedImageInfo) {
                  existsResult = await imageStorage.imageExistsByObjectKey(cachedImageInfo.objectKey);
                  if (existsResult) {
                    dbImagePath = `/${cachedImageInfo.objectKey}`;
                    // 提取缓存的文本数据
                    if (cachedImageInfo.renderConfig && cachedImageInfo.renderConfig.textData) {
                      cachedTextData = cachedImageInfo.renderConfig.textData;
                      console.log('✅ 从缓存中恢复文本数据');
                      if (cachedTextData) {
                        context.title = context.title || cachedTextData.title;
                        context.link = context.link || cachedTextData.link;
                        context.source = context.source || cachedTextData.source;
                        context.category = context.category || params.category;
                        context.publishTime = context.publishTime || cachedTextData.publishTime;
                        context.fingerprint = context.fingerprint || cachedTextData.fingerprint || newsFingerprint;
                      }
                    }
                  }
                }
              }
            } catch (searchError) {
              console.warn('⚠️ 缓存搜索失败:', searchError);
            }

            if (existsResult) {
              imageUrl = existsResult.url;
              localCacheHit = true;
              console.log(`✅ MinIO缓存命中: ${imageUrl}`);
              // Cache 职责：只恢复数据，不触发推送
            }
          } catch (cacheCheckError) {
            console.warn('⚠️ MinIO缓存检查失败:', cacheCheckError);
          }
        }

        if (!localCacheHit || params.force) {
          if (params.force) {
            debugLog('🔄 强制刷新，执行完整渲染...');
          } else {
            debugLog('📱 缓存未命中，执行完整渲染...');
          }

          renderResult = params.renderer === 'local-eink'
            ? await modularNewsPlugin.getRenderableData(params)
            : (await modularNewsPlugin.getData(params)) as unknown as Record<string, any> | null;

          if (params.renderer !== 'local-eink' && renderResult && typeof renderResult === 'object' && renderResult.imageUrl) {
            imageUrl = renderResult.imageUrl;
            // 解析 objectKey 用于数据库记录
            if (imageUrl.includes('/quote0-images/')) {
              const urlParts = new URL(imageUrl);
              const objectKey = urlParts.pathname.substring('/quote0-images/'.length);
              dbImagePath = '/' + objectKey;
            }

            try {
              debugLog('💾 保存渲染结果到MinIO缓存...');

              const imageUrlValue = renderResult.imageUrl;
              if (imageUrlValue && imageUrlValue.includes('/quote0-images/')) {
                const urlParts = new URL(imageUrlValue);
                const objectKey = urlParts.pathname.substring('/quote0-images/'.length);

                const postgres = cacheInternals.postgres;
                const cacheConfig = cacheInternals.config;
                if (postgres?.setCachedImage && cacheConfig?.imageCacheTTL) {
                  await postgres.setCachedImage({
                    cacheKey: cacheKeyString,
                    bucketName: 'quote0-images',
                    objectKey,
                    objectSize: 0,
                    contentType: 'image/png',
                    etag: 'unknown',
                    widgetType: 'news',
                    renderConfig: {
                      ...config,
                      // 保存文本数据，确保缓存命中时的一致性
                      textData: {
                        title: renderResult.title,
                        message: renderResult.message,
                        summary: renderResult.summary || renderResult.message,
                        source: renderResult.source,
                        signature: renderResult.signature,
                        link: renderResult.link,
                        publishTime: context.publishTime || renderResult.publishTime || null,
                        fingerprint: newsFingerprint
                      }
                    } as Record<string, unknown>,
                    ttl: cacheConfig.imageCacheTTL
                  });
                }

                console.log(`✅ 渲染结果已缓存: ${cacheKeyString} -> ${objectKey}`);
              } else {
                console.warn('⚠️ 无法解析图片URL，跳过缓存保存');
              }

              // 更新 news_cache 表的 image_path 字段
              if (dbImagePath) {
                try {
                  const { getPostgresDatabase } = await import('../react-widgets/core/postgres-database.js');
                  const postgres = getPostgresDatabase();
                  const client = await postgres.getClient();

                  try {
                    const updateResult = await client.query(
                      `UPDATE news_cache
                       SET image_path = $1
                       WHERE source = $2 AND category_name = $3 AND index_num = $4
                       RETURNING id`,
                      [
                        dbImagePath,
                        `${params.dataSource}_${params.rssSource}`,
                        params.category,
                        params.index
                      ]
                    );

                    if (updateResult.rowCount && updateResult.rowCount > 0) {
                      console.log(`💾 已更新 news_cache.image_path: ${dbImagePath} (影响${updateResult.rowCount}行)`);
                    }
                  } finally {
                    client.release();
                  }
                } catch (updateError) {
                  console.error('❌ 更新 news_cache.image_path 失败:', updateError);
                }
              }
            } catch (cacheError) {
              console.warn('⚠️ 保存缓存失败:', cacheError);
            }
          } else if (params.renderer !== 'local-eink') {
            throw new Error('渲染未返回有效结果');
          }
        }

        const mergedTextData = {
          title: cachedTextData?.title ?? renderResult?.title ?? context.title,
          message: cachedTextData?.message ?? renderResult?.message ?? context.description,
          summary:
            cachedTextData?.summary ??
            renderResult?.summary ??
            renderResult?.message ??
            cachedTextData?.message ??
            context.description,
          source: cachedTextData?.source ?? renderResult?.source ?? context.source,
          signature: cachedTextData?.signature ?? renderResult?.signature,
          link: cachedTextData?.link ?? renderResult?.link ?? context.link
        };

        // 统一推送：无论 cache hit 还是 cache miss，推送只在这里发生一次。
        // local-eink 例外：必须根据每台设备的运行时 RenderTarget 重新排版。
        let pushResult: {
          /** 向后兼容：语义为“至少一台设备成功”（= status !== 'failure'）。 */
          ok: boolean;
          status?: 'success' | 'partial_success' | 'failure';
          succeeded?: number;
          failed?: number;
          deviceResult?: string;
          pushResults?: any[];
          renderedImages?: Array<{ targetId: string; width: number; height: number; imageUrl?: string; localImagePath?: string; deviceIds: string[] }>;
          error?: string;
        } | null = null;
        if (imageUrl || params.renderer === 'local-eink') {
          console.log(`📤 统一推送到设备 (${params.renderer})...`);
          if (params.renderer === 'local-eink') {
            pushResult = await renderAndPushLocalEinkByTarget({
              id: newsFingerprint,
              title: mergedTextData.title || context.title || '未知标题',
              message: mergedTextData.message || mergedTextData.summary || context.description || '',
              signature: mergedTextData.signature || 'RSS智能',
              source: mergedTextData.source || context.source || 'unknown',
              publishTime: context.publishTime || new Date().toISOString(),
              category: context.category || params.category,
              link: mergedTextData.link,
            } as any);
          } else {
            const pusherInput = localCacheHit ? imageUrl : (renderResult?.localImagePath || imageUrl);
            pushResult = await devicePusher.push(pusherInput, params.renderer);
          }
        }

        if (params.renderer === 'local-eink' && pushResult?.renderedImages?.[0]) {
          imageUrl = pushResult.renderedImages[0].imageUrl || '';
          dbImagePath = pushResult.renderedImages[0].localImagePath;
        }

        result = {
          imageUrl,
          localImagePath: dbImagePath,
          deviceResult: pushResult?.deviceResult || pushResult?.error || '未推送',
          pushStatus: pushResult?.status,
          pushSucceeded: pushResult?.succeeded,
          pushFailed: pushResult?.failed,
          pushResults: pushResult?.pushResults,
          renderedImages: pushResult?.renderedImages,
          title: mergedTextData.title,
          message: mergedTextData.message,
          summary: mergedTextData.summary,
          source: mergedTextData.source,
          signature: mergedTextData.signature,
          link: mergedTextData.link,
          cacheInfo: {
            hit: localCacheHit,
            source: localCacheHit ? 'minio_cache' : (params.renderer === 'local-eink' ? 'target_render' : 'original'),
            cacheKey: cacheKeyString
          }
        };

        cacheHit = localCacheHit;
        cacheSource = localCacheHit ? 'minio_cache' : 'original';
      }

      if (cacheHit) {
        console.log(`✅ 缓存命中! 来源: ${cacheSource}`);
      } else {
        console.log('🔄 缓存未命中，执行了完整处理');
      }
    } catch (cacheError) {
      console.warn('⚠️ 分阶段缓存处理失败，回退到直接处理:', cacheError);
      result = params.renderer === 'local-eink'
        ? await modularNewsPlugin.getRenderableData(params)
        : await modularNewsPlugin.getData(params);
      cacheHit = false;
      cacheSource = 'fallback';
    }
  } else {
    if (params.force) {
      console.log('🔄 强制刷新模式，跳过缓存检查');
    } else {
      console.log('📊 其他渲染器，跳过缓存检查');
    }

    result = params.renderer === 'local-eink'
      ? await modularNewsPlugin.getRenderableData(params)
      : await modularNewsPlugin.getData(params);
    cacheHit = false;
    cacheSource = params.force ? 'forced' : 'no_cache';

    // 对于 device / local-eink，即使 skip cache 也要执行统一推送
    if ((params.renderer === 'device' || params.renderer === 'local-eink') && result && typeof result === 'object' && (params.renderer === 'local-eink' || result.imageUrl)) {
      const pushResult: any = params.renderer === 'local-eink'
        ? await renderAndPushLocalEinkByTarget({
            id: String(result.id || params.index),
            title: result.title || '未知标题',
            message: result.message || result.summary || '',
            signature: result.signature || 'RSS智能',
            source: result.source || params.rssSource,
            publishTime: result.publishTime || new Date().toISOString(),
            category: result.category || params.category,
            link: result.link,
          } as any)
        : await devicePusher.push(result.localImagePath || result.imageUrl, params.renderer);
      result = {
        ...result,
        ...(params.renderer === 'local-eink' && pushResult.renderedImages?.[0]
          ? {
              imageUrl: pushResult.renderedImages[0].imageUrl,
              localImagePath: pushResult.renderedImages[0].localImagePath
            }
          : {}),
        deviceResult: pushResult.deviceResult || ('error' in pushResult ? pushResult.error : undefined),
        pushStatus: pushResult.status,
        pushSucceeded: pushResult.succeeded,
        pushFailed: pushResult.failed,
        pushResults: pushResult.pushResults,
        renderedImages: pushResult.renderedImages
      };
    }

    // 更新 news_cache 表的 image_path 字段
    if ((params.renderer === 'device' || params.renderer === 'local-eink') && typeof result === 'object' && result?.imageUrl) {
      try {
        const { getPostgresDatabase } = await import('../react-widgets/core/postgres-database.js');
        const postgres = getPostgresDatabase();
        const client = await postgres.getClient();

        let dbPath: string | undefined;
        if (result.imageUrl.includes('/quote0-images/')) {
          const urlParts = new URL(result.imageUrl);
          dbPath = '/' + urlParts.pathname.substring('/quote0-images/'.length);
        }

        if (dbPath) {
          const updateResult = await client.query(
            `UPDATE news_cache
             SET image_path = $1
             WHERE source = $2 AND category_name = $3 AND index_num = $4
             RETURNING id`,
            [
              dbPath,
              `${params.dataSource}_${params.rssSource}`,
              params.category,
              params.index
            ]
          );

          if (updateResult.rowCount && updateResult.rowCount > 0) {
            console.log(`💾 已更新 news_cache.image_path: ${dbPath} (影响${updateResult.rowCount}行)`);
          }
        }
      } catch (updateError) {
        console.error('❌ 更新 news_cache.image_path 失败:', updateError);
      }
    }
  }

  const processingTime = Date.now() - startTime;

  enrichContextFromResult(context, result);
  if (!context.fingerprint) {
    context.fingerprint = computeNewsFingerprint({
      title: context.title,
      link: context.link,
      publishTime: context.publishTime,
      source: context.source,
      category: context.category,
      fallback: `${params.dataSource}:${params.rssSource}:${params.index}`
    });
  }

  console.log(`✅ 新闻处理完成，耗时: ${processingTime}ms, 缓存: ${cacheHit ? '命中' : '未命中'}(${cacheSource})`);

  return {
    result,
    cacheHit,
    cacheSource,
    cacheKey: JSON.stringify(cacheKey),
    cacheKeyObject: cacheKey,
    processingTime,
    workflow: `${params.dataSource} -> ${params.processor} -> ${params.renderer}`,
    params,
    config,
    context
  };
}

export function enrichContextFromResult(context: NewsPushContext, result: any): void {
  if (!result || typeof result !== 'object') {
    return;
  }

  if (!context.title && typeof result.title === 'string') {
    context.title = result.title;
  }
  if (!context.link && typeof result.link === 'string') {
    context.link = result.link;
  }
  if (!context.source && typeof result.source === 'string') {
    context.source = result.source;
  }
  if (!context.category && typeof result.category === 'string') {
    context.category = result.category;
  }
  if (!context.publishTime && typeof result.publishTime === 'string') {
    context.publishTime = result.publishTime;
  }
  if (!context.fingerprint && typeof result.fingerprint === 'string') {
    context.fingerprint = result.fingerprint;
  }
}

export function computeNewsFingerprint(payload: {
  title?: string;
  link?: string;
  publishTime?: string;
  source?: string;
  category?: string;
  fallback: string;
}): string {
  const normalizedLink = payload.link?.trim().toLowerCase() || '';
  const normalizedTitle = payload.title?.trim() || '';
  const normalizedPublishTime = payload.publishTime ? new Date(payload.publishTime).toISOString() : '';
  const normalizedSource = payload.source?.trim().toLowerCase() || '';
  const normalizedCategory = payload.category?.trim().toLowerCase() || '';

  const base = [normalizedLink, normalizedTitle, normalizedPublishTime, normalizedSource, normalizedCategory]
    .filter(Boolean)
    .join('||');

  const seed = base || payload.fallback;
  return createHash('sha256').update(seed).digest('hex').substring(0, 32);
}
