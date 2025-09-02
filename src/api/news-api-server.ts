/**
 * Hono API服务器 - 模块化新闻处理API
 * 提供REST API接口替代CLI命令行操作
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { validator } from 'hono/validator';
import { modularNewsPlugin } from '../react-widgets/plugins/modular-news-plugin.js';
import { stagedCacheManager } from '../react-widgets/core/staged-cache-manager.js';

// API请求类型定义
interface NewsProcessRequest {
  category?: string;
  dataSource?: string; 
  rssSource?: string;
  processor?: string;
  index?: number;
  renderer?: string;
  options?: {
    force?: boolean;
    border?: '0' | '1';
    width?: number;
    height?: number;
  };
}

interface NewsProcessResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    processingTime: number;
    workflow: string;
    nodeTimings: Record<string, number>;
    cache?: {
      hit: boolean;
      source: string;
      key: string;
    };
  };
}

// RSS源信息
interface RSSSourceInfo {
  id: string;
  name: string;
  description: string;
  category: string;
}

// 创建Hono应用
const app = new Hono();

// 中间件配置
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'OPTIONS']
}));

app.use('*', logger());
app.use('*', prettyJSON());

// RSS源数据配置
const RSS_SOURCES: Record<string, RSSSourceInfo> = {
  // 科技资讯
  solidot: {
    id: 'solidot',
    name: 'Solidot',
    description: '奇客的资讯，重要的东西',
    category: 'technology'
  },
  sspai: {
    id: 'sspai', 
    name: '少数派',
    description: '高效工作，品质生活',
    category: 'technology'
  },
  cnbeta: {
    id: 'cnbeta',
    name: 'cnBeta', 
    description: '中文业界资讯站',
    category: 'technology'
  },
  pingwest: {
    id: 'pingwest',
    name: 'PingWest',
    description: '科技媒体平台',
    category: 'technology'
  },
  techcrunch: {
    id: 'techcrunch',
    name: 'TechCrunch',
    description: '全球科技创业资讯',
    category: 'technology'
  },
  arstechnica: {
    id: 'arstechnica',
    name: 'Ars Technica',
    description: '深度科技分析',
    category: 'technology'
  },
  
  // 商业财经
  '36kr': {
    id: '36kr',
    name: '36氪',
    description: '创投媒体平台',
    category: 'business'
  },
  'reuters-tech': {
    id: 'reuters-tech',
    name: 'Reuters Tech',
    description: '路透社科技新闻',
    category: 'business'
  },
  
  // 设计创意
  'designer-news': {
    id: 'designer-news',
    name: 'Designer News',
    description: '设计师资讯平台',
    category: 'design'
  },
  
  // 开发者
  'github-trending': {
    id: 'github-trending',
    name: 'GitHub Trending',
    description: 'GitHub热门项目',
    category: 'programming'
  },
  'dev-to': {
    id: 'dev-to',
    name: 'DEV Community',
    description: '开发者技术分享',
    category: 'programming'
  }
};

// API路由

/**
 * 根路径 - API信息
 */
app.get('/', (c) => {
  return c.json({
    service: 'Modular News API',
    version: '1.0.0',
    description: '模块化新闻处理API服务',
    endpoints: {
      'POST /api/news/process': '处理新闻请求',
      'GET /api/news/sources': '获取可用RSS源',
      'GET /api/health': '健康检查',
      'GET /api/health/modules': '模块健康状态'
    }
  });
});

/**
 * 处理新闻请求 - 核心API
 */
app.post('/api/news/process', 
  validator('json', (value, c) => {
    const body = value as NewsProcessRequest;
    
    // 基本参数验证
    if (body.dataSource === 'rss' && body.rssSource && !RSS_SOURCES[body.rssSource]) {
      return c.json({ 
        success: false, 
        error: `不支持的RSS源: ${body.rssSource}。支持的RSS源: ${Object.keys(RSS_SOURCES).join(', ')}` 
      }, 400);
    }
    
    return body;
  }),
  async (c) => {
    const startTime = Date.now();
    
    try {
      const body = await c.req.json() as NewsProcessRequest;
      
      console.log('🚀 API请求处理开始:', body);
      
      // 构建模块化新闻参数
      const params = {
        category: body.category || 'technology',
        dataSource: body.dataSource || 'mock',
        processor: body.processor || 'passthrough', 
        renderer: body.renderer || 'news',
        index: body.index || 0,
        rssSource: body.rssSource || 'solidot',
        force: body.options?.force || false
      };
      
      // 构建配置
      const config = {
        border: body.options?.border || '0',
        width: body.options?.width || 640,
        height: body.options?.height || 384
      };
      
      console.log('📋 处理参数:', params);
      console.log('⚙️ 配置:', config);
      
      // 参数验证
      if (!modularNewsPlugin.validateParams(params)) {
        return c.json({
          success: false,
          error: '参数验证失败'
        }, 400);
      }
      
      if (!modularNewsPlugin.validateConfig(config)) {
        return c.json({
          success: false,
          error: '配置验证失败'
        }, 400);
      }
      
      // 生成缓存键
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

      // 初始化缓存管理器（如果尚未初始化）
      try {
        await stagedCacheManager.initialize();
      } catch (error) {
        console.warn('⚠️ 缓存系统初始化失败，使用直接处理:', error);
      }

      let result: any;
      let cacheHit = false;
      let cacheSource = 'none';

      // 缓存策略：分阶段缓存实现
      if (!params.force && (params.renderer === 'json' || params.renderer === 'device')) {
        try {
          if (params.renderer === 'json') {
            console.log('🔍 JSON渲染器 - 检查数据缓存...');
            
            // JSON渲染器：直接缓存完整结果
            const newsResult = await stagedCacheManager.getOrCacheNewsData(
              cacheKey,
              async () => {
                console.log('🔄 缓存未命中，执行完整的JSON处理流程...');
                return await modularNewsPlugin.getData(params);
              },
              params.force
            );

            result = newsResult.data;
            cacheHit = newsResult.source !== 'original';
            cacheSource = newsResult.source;
            
          } else if (params.renderer === 'device') {
            console.log('📱 设备推送渲染器 - 启用MinIO直接缓存...');
            
            // 生成唯一缓存键（基于所有影响渲染结果的参数）
            const cacheKeyString = `${params.dataSource}_${params.rssSource}_${params.processor}_${params.category}_${params.index}`;
            console.log(`🔑 生成缓存键: ${cacheKeyString}`);
            
            // 尝试从MinIO获取缓存的渲染结果
            let imageUrl = '';
            let localCacheHit = false;
            let devicePushResult = '推送成功';
            
            if (!params.force) {
              try {
                console.log('🔍 检查MinIO中的缓存图片...');
                
                // 检查MinIO中是否存在以cacheKeyString命名的图片文件
                // 由于文件名包含timestamp，我们需要搜索匹配的文件
                console.log('🔍 搜索MinIO中匹配的缓存图片...');
                
                // 尝试获取MinIO中的文件列表，查找匹配的缓存文件
                const { getImageStorage } = await import('../react-widgets/core/image-storage.js');
                const imageStorage = getImageStorage();
                
                // 构建搜索模式：查找包含缓存键的文件
                const searchPattern = `modular_${params.rssSource}_${params.index}_`;
                console.log(`🔍 搜索模式: ${searchPattern}`);
                
                let existsResult = null;
                
                try {
                  // 简化版：直接检查数据库中的缓存记录
                  const cachedImageInfo = await stagedCacheManager.postgres.getCachedImage(cacheKeyString);
                  if (cachedImageInfo) {
                    existsResult = await imageStorage.imageExistsByObjectKey(cachedImageInfo.objectKey);
                  }
                } catch (searchError) {
                  console.warn('⚠️ 缓存搜索失败:', searchError);
                }
                
                if (existsResult) {
                  imageUrl = existsResult.url;
                  localCacheHit = true;
                  console.log(`✅ MinIO缓存命中: ${imageUrl}`);
                  
                  // 缓存命中：下载图片并推送到设备
                  console.log('📤 使用缓存图片执行设备推送...');
                  
                  try {
                    // 从MinIO下载图片到本地临时文件
                    const fs = await import('fs/promises');
                    const path = await import('path');
                    const { tmpdir } = await import('os');
                    const https = await import('https');
                    const http = await import('http');
                    
                    const tempFileName = `cached_${Date.now()}.png`;
                    const tempFilePath = path.join(tmpdir(), tempFileName);
                    
                    // 下载图片
                    const { createWriteStream } = await import('fs');
                    await new Promise((resolve, reject) => {
                      const client = imageUrl.startsWith('https:') ? https : http;
                      const file = createWriteStream(tempFilePath);
                      
                      client.get(imageUrl, (response) => {
                        response.pipe(file);
                        file.on('finish', resolve);
                        file.on('error', reject);
                      }).on('error', reject);
                    });
                    
                    // 执行设备推送
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
                    
                    // 清理临时文件
                    try {
                      await fs.unlink(tempFilePath);
                    } catch (cleanupError) {
                      console.warn('⚠️ 清理临时文件失败:', cleanupError);
                    }
                    
                    devicePushResult = '缓存图片推送成功';
                    
                  } catch (pushError) {
                    console.error('❌ 缓存图片推送失败:', pushError);
                    devicePushResult = `缓存图片推送失败: ${pushError.message}`;
                  }
                }
              } catch (cacheCheckError) {
                console.warn('⚠️ MinIO缓存检查失败:', cacheCheckError);
              }
            }
            
            // 如果缓存未命中或强制刷新，执行完整的设备推送流程
            if (!localCacheHit || params.force) {
              if (params.force) {
                console.log('🔄 强制刷新，执行完整设备推送...');
              } else {
                console.log('📱 缓存未命中，执行完整设备推送...');
              }
              
              const deviceResult = await modularNewsPlugin.getData(params);
              
              if (typeof deviceResult === 'object' && deviceResult.imageUrl) {
                imageUrl = deviceResult.imageUrl;
                devicePushResult = deviceResult.deviceResult || '推送完成';
                
                // 将新渲染的图片保存为缓存
                try {
                  console.log('💾 保存渲染结果到MinIO缓存...');
                  
                  // 从MinIO URL中提取对象键信息
                  const imageUrl = deviceResult.imageUrl;
                  if (imageUrl && imageUrl.includes('/quote0-images/')) {
                    const urlParts = new URL(imageUrl);
                    const objectKey = urlParts.pathname.substring('/quote0-images/'.length); // 去掉bucket名称
                    
                    // 将图片信息保存到数据库缓存记录中
                    await stagedCacheManager.postgres.setCachedImage({
                      cacheKey: cacheKeyString,
                      bucketName: 'quote0-images',
                      objectKey: objectKey,
                      objectSize: 0, // 暂时未知
                      contentType: 'image/png',
                      etag: 'unknown',
                      widgetType: 'news',
                      renderConfig: config,
                      ttl: stagedCacheManager.config.imageCacheTTL
                    });
                    
                    console.log(`✅ 渲染结果已缓存: ${cacheKeyString} -> ${objectKey}`);
                  } else {
                    console.warn('⚠️ 无法解析图片URL，跳过缓存保存');
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
              deviceResult: devicePushResult,
              cacheInfo: {
                hit: localCacheHit,
                source: localCacheHit ? 'minio_cache' : 'original',
                cacheKey: cacheKeyString
              }
            };
            
            // 重新设置全局变量以用于最终的缓存报告
            cacheHit = localCacheHit;
            cacheSource = localCacheHit ? 'minio_cache' : 'original';
          }
          
          if (cacheHit) {
            console.log(`✅ 缓存命中! 来源: ${cacheSource}`);
          } else {
            console.log(`🔄 缓存未命中，执行了完整处理`);
          }

        } catch (cacheError) {
          console.warn('⚠️ 分阶段缓存处理失败，回退到直接处理:', cacheError);
          result = await modularNewsPlugin.getData(params);
          cacheHit = false;
          cacheSource = 'fallback';
        }
      } else {
        // 强制刷新或其他渲染器：直接处理
        if (params.force) {
          console.log('🔄 强制刷新模式，跳过缓存检查');
        } else {
          console.log('📊 其他渲染器，跳过缓存检查');
        }
        
        result = await modularNewsPlugin.getData(params);
        cacheHit = false;
        cacheSource = params.force ? 'forced' : 'no_cache';
      }

      const processingTime = Date.now() - startTime;
      
      console.log(`✅ API请求处理完成，耗时: ${processingTime}ms, 缓存: ${cacheHit ? '命中' : '未命中'}(${cacheSource})`);
      
      const response: NewsProcessResponse = {
        success: true,
        data: result,
        metadata: {
          processingTime,
          workflow: `${params.dataSource} -> ${params.processor} -> ${params.renderer}`,
          nodeTimings: {}, // TODO: 从结果中提取节点耗时
          cache: {
            hit: cacheHit,
            source: cacheSource,
            key: JSON.stringify(cacheKey)
          }
        }
      };
      
      return c.json(response);
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error('❌ API请求处理失败:', error);
      
      const response: NewsProcessResponse = {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        metadata: {
          processingTime,
          workflow: 'failed',
          nodeTimings: {}
        }
      };
      
      return c.json(response, 500);
    }
  }
);

/**
 * 获取可用RSS源
 */
app.get('/api/news/sources', (c) => {
  const category = c.req.query('category');
  
  let sources = RSS_SOURCES;
  
  // 如果指定了分类，进行过滤
  if (category) {
    sources = Object.fromEntries(
      Object.entries(RSS_SOURCES).filter(([_, source]) => source.category === category)
    );
  }
  
  // 按分类分组
  const groupedSources: Record<string, RSSSourceInfo[]> = {};
  
  for (const [id, source] of Object.entries(sources)) {
    if (!groupedSources[source.category]) {
      groupedSources[source.category] = [];
    }
    groupedSources[source.category].push(source);
  }
  
  return c.json({
    sources: groupedSources,
    total: Object.keys(sources).length,
    categories: Object.keys(groupedSources)
  });
});

/**
 * 健康检查 - 基础状态
 */
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Modular News API',
    version: '1.0.0'
  });
});

/**
 * 健康检查 - 模块状态
 */
app.get('/api/health/modules', async (c) => {
  try {
    const healthStatus = await modularNewsPlugin.getModuleHealthStatus();
    
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: healthStatus
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy', 
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : '未知错误'
    }, 500);
  }
});

/**
 * API文档/帮助
 */
app.get('/api/docs', (c) => {
  return c.json({
    title: 'Modular News API 文档',
    version: '1.0.0',
    baseUrl: '/api',
    endpoints: {
      'POST /news/process': {
        description: '处理新闻请求',
        parameters: {
          category: 'string (technology|finance|sports) - 新闻分类',
          dataSource: 'string (rss|mock|api|hackernews) - 数据源',
          rssSource: 'string - RSS订阅源ID，当dataSource=rss时使用',
          processor: 'string (passthrough|basic-llm|ax-optimized) - 处理器',
          index: 'number - 新闻条目索引',
          renderer: 'string (news|json|device) - 渲染器',
          options: {
            force: 'boolean - 强制刷新',
            border: 'string (0|1) - 边框设置',
            width: 'number - 图片宽度',
            height: 'number - 图片高度'
          }
        },
        example: {
          category: 'technology',
          dataSource: 'rss',
          rssSource: 'sspai',
          processor: 'ax-optimized', 
          index: 7,
          renderer: 'device',
          options: {
            force: false,
            border: '0'
          }
        }
      },
      'GET /news/sources': {
        description: '获取可用RSS源',
        parameters: {
          category: 'string (可选) - 按分类过滤'
        }
      },
      'GET /health': {
        description: '基础健康检查'
      },
      'GET /health/modules': {
        description: '模块健康状态检查'
      }
    },
    availableRSSSources: Object.keys(RSS_SOURCES),
    categories: [...new Set(Object.values(RSS_SOURCES).map(s => s.category))]
  });
});

// 404处理
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'API端点未找到',
    message: '请访问 /api/docs 查看可用的API端点'
  }, 404);
});

// 错误处理
app.onError((error, c) => {
  console.error('API服务器错误:', error);
  
  return c.json({
    success: false,
    error: '内部服务器错误',
    message: error.message
  }, 500);
});

export default app;