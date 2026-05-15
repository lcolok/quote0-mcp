/**
 * 本地验证：天气 emoji 修复后能否正确渲染
 * 测试 8 种天气：大雨/雷阵雨/多云/晴/阴/雪/雾/大风
 */

import React from 'react';
import { satoriRenderer } from '../src/react-widgets/core/satori-renderer.js';
import { SatoriWeatherWidget } from '../src/react-widgets/components/SatoriWeatherWidget.js';

const cases = [
  { weather: '大雨', tomorrowWeather: '中雨' },
  { weather: '雷阵雨', tomorrowWeather: '阵雨' },
  { weather: '多云', tomorrowWeather: '晴' },
  { weather: '晴', tomorrowWeather: '多云' },
  { weather: '阴', tomorrowWeather: '阴' },
  { weather: '小雪', tomorrowWeather: '中雪' },
  { weather: '大雾', tomorrowWeather: '霾' },
  { weather: '大风', tomorrowWeather: '晴' }
];

async function main() {
  await satoriRenderer.initialize();
  const fs = await import('fs');

  for (const c of cases) {
    const data = {
      city: '广州',
      province: '广东',
      temperature: 29,
      weather: c.weather,
      humidity: 78,
      windDirection: '东北',
      windPower: '<=3',
      feelst: 31,
      tomorrowWeather: c.tomorrowWeather
    };

    const buf = await satoriRenderer.renderToImage(
      React.createElement(SatoriWeatherWidget, { data, invertedBanner: true }),
      { width: 296, height: 152, backgroundColor: '#FFFFFF' }
    );

    const path = `/tmp/weather-emoji-fix-${c.weather}.png`;
    await fs.promises.writeFile(path, buf);
    console.log(`✅ ${c.weather} → ${path} (${buf.length}B)`);
  }

  await satoriRenderer.close();
}

main().catch(e => { console.error(e); process.exit(1); });
