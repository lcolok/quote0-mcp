/**
 * 懒猫微服环境适配配置
 * 提供动态获取服务地址的配置
 */

/**
 * 获取 API 服务器基础 URL
 * 在懒猫环境中，通过环境变量或相对路径获取
 */
export function getApiBaseUrl(): string {
  // 懒猫环境标记
  if (process.env.LZC_APP === 'true') {
    // 在懒猫环境中，使用相对路径或内部域名
    const subdomain = process.env.LZC_SUBDOMAIN || 'quote0';
    return `http://news-api.${subdomain}.lzcapp:3001`;
  }
  
  // 本地开发环境
  return process.env.API_BASE_URL || 'http://localhost:3001';
}

/**
 * 获取字体服务器 URL
 */
export function getFontServerUrl(): string {
  return getApiBaseUrl();
}

/**
 * 检查是否在懒猫环境中运行
 */
export function isLazyCatEnvironment(): boolean {
  return process.env.LZC_APP === 'true' || process.env.LZC_SDK_VERSION !== undefined;
}

/**
 * 获取当前环境的描述
 */
export function getEnvironmentInfo(): { name: string; baseUrl: string } {
  if (isLazyCatEnvironment()) {
    return {
      name: 'LazyCat Microserver',
      baseUrl: getApiBaseUrl()
    };
  }
  
  return {
    name: 'Local Development',
    baseUrl: getApiBaseUrl()
  };
}
