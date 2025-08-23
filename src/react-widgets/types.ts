/**
 * React 小组件系统类型定义
 */

export interface WeatherData {
  city: string;
  temperature: number;
  weather: string;
  humidity: number;
  
  // 基础字段（组件必需）
  windDirection?: string;
  windLevel?: number;
  aqi?: number;
  aqiLevel?: string;
  pressure?: number;
  sunrise?: string;
  sunset?: string;
  
  // 真实API扩展字段（可选）
  windSpeed?: number;
  windScale?: string;
  feelst?: number;        // 体感温度
  lastUpdate?: string;    // 最后更新时间
  jieQi?: string;        // 节气
  
  // 预报数据（可选）
  forecast?: {
    tomorrow?: {
      weather: string;
      tempRange: {
        min: number;
        max: number;
      };
    };
  };
}

export interface WidgetConfig {
  width: number;
  height: number;
  theme: 'light' | 'dark' | 'eink';
  fontSize: 'small' | 'medium' | 'large';
}

export interface RenderOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  backgroundColor?: string;
  dithering?: boolean;
}