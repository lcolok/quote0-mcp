import { createHash } from 'crypto';
import { modularNewsPlugin } from '../react-widgets/plugins/modular-news-plugin.js';
import { stagedCacheManager } from '../react-widgets/core/staged-cache-manager.js';
import type { NewsData } from '../react-widgets/components/NewsWidget.js';
import type {
  FullNewsProcessingResult,
  NewsProcessRequest,
  NewsProcessingConfig,
  NewsProcessingParams,
  NewsPushContext
} from './news-types.js';

export async function processNews(body: NewsProcessRequest): Promise<FullNewsProcessingResult> {
  const startTime = Date.now();

  console.log('🚀 新闻处理任务开始:', body);

  const params: NewsProcessingParams = {
    category: body.category || 'technology',
    dataSource: body.dataSource || 'mock',
    processor: body.processor || 'passthrough',
    renderer: body.renderer || 'news',
    index: body.index ?? 0,
    rssSource: body.rssSource || 'solidot',
    force: body.options?.force ?? false
  };

  const config: NewsProcessingConfig = {
    border: (body.options?.border || '0') as '0' | '1',
    width: body.options?.width || 640,
    height: body.options?.height || 384
  };

  // 如果提供了mockData，注入到环境中
  if (body.mockData) {
    (global as any).__PLAYGROUND_MOCK_DATA__ = body.mockData;
  }

  console.log('📋 处理参数:', params);
  console.log('⚙️ 配置:', config);

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

  console.log('🔍 检查缓存，缓存键:', cacheKey);

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

  if (!params.force && (params.renderer === 'json' || params.renderer === 'device')) {
    try {
      if (params.renderer === 'json') {
        console.log('🔍 JSON渲染器 - 检查数据缓存...');

        const newsResult = await stagedCacheManager.getOrCacheNewsData(
          cacheKey,
          async () => {
            console.log('🔄 缓存未命中，执行完整的JSON处理流程...');
            return (await modularNewsPlugin.getData(params)) as unknown as NewsData;
          },
          params.force
        );

        result = newsResult.data;
        cacheHit = newsResult.source !== 'original';
        cacheSource = newsResult.source;
      } else if (params.renderer === 'device') {
        console.log('📱 设备推送渲染器 - 启用MinIO直接缓存...');

        // 🔑 先获取原始RSS数据以获得稳定的fingerprint（使用passthrough避免LLM非确定性）
        console.log('📝 先获取原始新闻数据以计算fingerprint...');
        const jsonParams = { ...params, processor: 'passthrough' as const, renderer: 'json' as const };
        const jsonResult = await modularNewsPlugin.getData(jsonParams);
        const jsonData = jsonResult as any;

        // 从结果中提取fingerprint
        const newsFingerprint = jsonData?.fingerprint ||
                                jsonData?.metadata?.fingerprint ||
                                computeNewsFingerprint({
                                  title: jsonData?.title || '',
                                  link: jsonData?.link || '',
                                  publishTime: jsonData?.publishTime || '',
                                  source: jsonData?.source || '',
                                  category: jsonData?.category || params.category,
                                  fallback: `${params.dataSource}:${params.rssSource}:${params.index}`
                                });

        const cacheKeyString = `${params.dataSource}_${params.rssSource}_${params.processor}_${params.category}_${newsFingerprint}`;
        console.log(`🔑 生成缓存键（含fingerprint）: ${cacheKeyString}`);

        let imageUrl = '';
        let localImagePath: string | undefined = undefined;
        let localCacheHit = false;
        let devicePushResult = '推送成功';

        if (!params.force) {
          try {
            console.log('🔍 检查MinIO中的缓存图片...');

            const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
            const imageStorage = getImageStorage();

            const searchPattern = `modular_${params.rssSource}_${params.index}_`;
            console.log(`🔍 搜索模式: ${searchPattern}`);

            let existsResult: { url: string; objectKey?: string } | null = null;
            let cachedTextData: any = null; // 用于保存缓存的文本数据

            try {
              const postgres = cacheInternals.postgres;
              if (postgres?.getCachedImage) {
                const cachedImageInfo = await postgres.getCachedImage(cacheKeyString);
                if (cachedImageInfo) {
                  existsResult = await imageStorage.imageExistsByObjectKey(cachedImageInfo.objectKey);
                  if (existsResult) {
                    // 保存localImagePath用于数据库记录
                    localImagePath = `/${cachedImageInfo.objectKey}`;
                    // 提取缓存的文本数据
                    if (cachedImageInfo.renderConfig && (cachedImageInfo.renderConfig as any).textData) {
                      cachedTextData = (cachedImageInfo.renderConfig as any).textData;
                      console.log('✅ 从缓存中恢复文本数据');
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

              console.log('📤 使用缓存图片执行设备推送...');

              try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const { tmpdir } = await import('os');
                const https = await import('https');
                const http = await import('http');

                const tempFileName = `cached_${Date.now()}.png`;
                const tempFilePath = path.join(tmpdir(), tempFileName);

                const { createWriteStream } = await import('fs');
                await new Promise<void>((resolve, reject) => {
                  const client = imageUrl.startsWith('https:') ? https : http;
                  const file = createWriteStream(tempFilePath);

                  client.get(imageUrl, (response) => {
                    response.pipe(file);
                    file.on('finish', () => resolve());
                    file.on('error', reject);
                  }).on('error', reject);
                });

                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);

                const deviceCommand = `bunx tsx src/image-sender/interfaces/cli/cli-main.ts send-server-dither "${tempFilePath}" "0" "" "ORDERED"`;
                const { stdout, stderr } = await execAsync(deviceCommand, {
                  cwd: process.cwd(),
                  env: process.env
                });

                if (stdout) console.log(stdout);
                if (stderr) console.error(stderr);

                try {
                  await fs.unlink(tempFilePath);
                } catch (cleanupError) {
                  console.warn('⚠️ 清理临时文件失败:', cleanupError);
                }

                devicePushResult = '缓存图片推送成功';
              } catch (pushError: any) {
                console.error('❌ 缓存图片推送失败:', pushError);
                devicePushResult = `缓存图片推送失败: ${pushError.message}`;
              }
            }
          } catch (cacheCheckError) {
            console.warn('⚠️ MinIO缓存检查失败:', cacheCheckError);
          }
        }

        if (!localCacheHit || params.force) {
          if (params.force) {
            console.log('🔄 强制刷新，执行完整设备推送...');
          } else {
            console.log('📱 缓存未命中，执行完整设备推送...');
          }

          const deviceResult = (await modularNewsPlugin.getData(params)) as any;

          if (typeof deviceResult === 'object' && deviceResult?.imageUrl) {
            imageUrl = deviceResult.imageUrl;
            localImagePath = deviceResult.localImagePath;  // 保存localImagePath
            devicePushResult = deviceResult.deviceResult || '推送完成';

            try {
              console.log('💾 保存渲染结果到MinIO缓存...');

              const imageUrlValue = deviceResult.imageUrl;
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
                        title: (deviceResult as any).title,
                        message: (deviceResult as any).message,
                        summary: (deviceResult as any).summary || (deviceResult as any).message,
                        source: (deviceResult as any).source,
                        signature: (deviceResult as any).signature,
                        link: (deviceResult as any).link
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
              if (deviceResult.localImagePath) {
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
                        deviceResult.localImagePath,
                        `${params.dataSource}_${params.rssSource}`,
                        params.category,
                        params.index
                      ]
                    );

                    if (updateResult.rowCount && updateResult.rowCount > 0) {
                      console.log(`💾 已更新 news_cache.image_path: ${deviceResult.localImagePath} (影响${updateResult.rowCount}行)`);
                    } else {
                      console.warn(`⚠️ 未找到匹配的 news_cache 记录 (source: ${params.dataSource}_${params.rssSource}, category: ${params.category}, index: ${params.index})`);
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
          } else {
            throw new Error('设备推送未返回有效结果');
          }
        }

        result = {
          imageUrl,
          localImagePath,  // 添加localImagePath字段
          deviceResult: devicePushResult,
          // 从deviceResult或缓存中提取文本数据，确保与图片一致
          title: cachedTextData?.title || (deviceResult as any).title,
          message: cachedTextData?.message || (deviceResult as any).message,
          summary: cachedTextData?.summary || (deviceResult as any).summary || (deviceResult as any).message,
          source: cachedTextData?.source || (deviceResult as any).source,
          signature: cachedTextData?.signature || (deviceResult as any).signature,
          link: cachedTextData?.link || (deviceResult as any).link,
          cacheInfo: {
            hit: localCacheHit,
            source: localCacheHit ? 'minio_cache' : 'original',
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
      result = await modularNewsPlugin.getData(params);
      cacheHit = false;
      cacheSource = 'fallback';
    }
  } else {
    if (params.force) {
      console.log('🔄 强制刷新模式，跳过缓存检查');
    } else {
      console.log('📊 其他渲染器，跳过缓存检查');
    }

    result = await modularNewsPlugin.getData(params);
    cacheHit = false;
    cacheSource = params.force ? 'forced' : 'no_cache';

    // 对于设备推送，更新 news_cache 表的 image_path 字段
    if (params.renderer === 'device' && typeof result === 'object' && result?.localImagePath) {
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
              result.localImagePath,
              `${params.dataSource}_${params.rssSource}`,
              params.category,
              params.index
            ]
          );

          if (updateResult.rowCount && updateResult.rowCount > 0) {
            console.log(`💾 已更新 news_cache.image_path: ${result.localImagePath} (影响${updateResult.rowCount}行)`);
          } else {
            console.warn(`⚠️ 未找到匹配的 news_cache 记录 (source: ${params.dataSource}_${params.rssSource}, category: ${params.category}, index: ${params.index})`);
          }
        } finally {
          client.release();
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

function enrichContextFromResult(context: NewsPushContext, result: any): void {
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
