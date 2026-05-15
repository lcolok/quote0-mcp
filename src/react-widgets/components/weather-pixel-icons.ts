/**
 * 像素风天气图标（12×12 SVG → data URI）
 *
 * 用于 SatoriWeatherWidget 的天气图标显示。
 *
 * 历史教训：satori 未加载 emoji 字体且 FusionPixelFont 不含 emoji 子集，
 * 直接用 emoji 字符（🌧/⛈/❄ 等）在 SMP 范围全部渲染为方框 □；
 * 用中文单字虽能显示但视觉上不是"图标"。
 *
 * 解决方案：每种天气一个 12×12 手绘像素 ASCII 图，通过 helper 转为单色
 * SVG data URI，satori 用 <img> 标签加载。72×72 显示时每个源像素 = 6×6 px。
 */

type WeatherIconKey =
  | 'sun'         // 晴
  | 'cloud'       // 阴
  | 'partly'      // 多云
  | 'rain'        // 雨 / 阵雨
  | 'thunder'     // 雷雨 / 雷阵雨
  | 'snow'        // 雪 / 雨夹雪
  | 'fog'         // 雾 / 霾
  | 'wind'        // 大风
  | 'hail';       // 冰雹

// 12×12 ASCII：'#' = 黑色像素，其他字符 = 透明
const ICONS: Record<WeatherIconKey, string> = {
  // 晴：中心 4×4 实心 + 8 条放射光线（上下左右 2 格 + 4 对角 1 格）
  sun: `
.....##.....
.#...##...#.
..#......#..
............
....####....
##.######.##
##.######.##
....######..
............
..#......#..
.#...##...#.
.....##.....
`,

  // 阴：填充式云朵（4 阶台阶顶部 + 长方体底部）
  cloud: `
............
............
....####....
...######...
..########..
.##########.
.##########.
.##########.
.##########.
............
............
............
`,

  // 多云：左上小太阳 + 右下叠加云朵
  partly: `
##..........
####........
####........
.##.........
......####..
.....######.
....########
....########
....########
....########
............
............
`,

  // 雨：云 + 3 列斜向雨滴
  rain: `
....####....
..########..
.##########.
.##########.
............
.#..#..#..#.
#..#..#..#..
.#..#..#..#.
#..#..#..#..
............
............
............
`,

  // 雷雨：云 + 闪电折线
  thunder: `
....####....
..########..
.##########.
.##########.
............
......##....
.....##.....
....######..
......##....
.....##.....
............
............
`,

  // 雪：云 + 2×2 个 "+" 型雪花
  snow: `
....####....
..########..
.##########.
.##########.
............
...#....#...
..###..###..
...#....#...
............
....#....#..
...###..###.
....#....#..
`,

  // 雾：4 条横向断续线，模拟雾的层次感
  fog: `
............
............
.##########.
............
..#########.
............
.##########.
............
..#########.
............
.##########.
............
`,

  // 风：3 条带尾巴的气流线
  wind: `
............
............
..#######...
.........#..
.##########.
...........#
............
.#########..
.........#..
............
............
............
`,

  // 冰雹：云 + 3 个圆形冰珠（2×2 块）
  hail: `
....####....
..########..
.##########.
.##########.
............
...##.......
...##....##.
.........##.
....##......
....##......
............
............
`
};

function asciiToSvg(ascii: string): string {
  const lines = ascii.trim().split('\n');
  const rects: string[] = [];
  lines.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch === '#') {
        rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges"><g fill="#000000">${rects.join('')}</g></svg>`;
}

const ICON_DATA_URIS: Record<WeatherIconKey, string> = Object.fromEntries(
  Object.entries(ICONS).map(([key, ascii]) => [
    key,
    `data:image/svg+xml;base64,${Buffer.from(asciiToSvg(ascii)).toString('base64')}`
  ])
) as Record<WeatherIconKey, string>;

/**
 * 根据天气文本返回像素图标的 data URI
 */
export function getWeatherIconDataUri(weather: string): string {
  const w = (weather || '').toLowerCase();

  // 优先级：组合天气先匹配（雷 > 雨夹雪 > 普通雨/雪）
  if (w.includes('雷')) return ICON_DATA_URIS.thunder;
  if (w.includes('thunder') || w.includes('storm')) return ICON_DATA_URIS.thunder;

  if (w.includes('冰雹') || w.includes('hail')) return ICON_DATA_URIS.hail;

  if (w.includes('雨夹雪') || w.includes('雨雪') || w.includes('sleet')) return ICON_DATA_URIS.snow;

  if (w.includes('雨') || w.includes('rain') || w.includes('drizzle') || w.includes('shower')) {
    return ICON_DATA_URIS.rain;
  }

  if (w.includes('雪') || w.includes('snow')) return ICON_DATA_URIS.snow;

  if (w.includes('雾') || w.includes('fog') || w.includes('霾') || w.includes('haze') || w.includes('smog')) {
    return ICON_DATA_URIS.fog;
  }

  if (w.includes('大风') || w.includes('windy') || w.includes('gust')) return ICON_DATA_URIS.wind;

  if (w.includes('晴') || w.includes('sunny') || w.includes('clear')) return ICON_DATA_URIS.sun;

  if (w.includes('多云') || w.includes('partly')) return ICON_DATA_URIS.partly;

  if (w.includes('阴') || w.includes('overcast') || w.includes('cloudy')) return ICON_DATA_URIS.cloud;

  return ICON_DATA_URIS.partly;
}
