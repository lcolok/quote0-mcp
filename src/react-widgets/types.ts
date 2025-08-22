/**
 * React 小组件系统类型定义
 */

export interface WeatherData {
  city: string;
  temperature: number;
  weather: string;
  humidity: number;
  windDirection: string;
  windLevel: number;
  aqi: number;
  aqiLevel: string;
  pressure: number;
  sunrise: string;
  sunset: string;
  forecast: {
    tomorrow: {
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