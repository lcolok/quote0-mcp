export type DitherAlgorithm =
  | 'threshold'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'stucki'
  | 'burkes'
  | 'sierra'
  | 'sierra-2'
  | 'sierra-lite'
  | 'bayer-4x4'
  | 'bayer-8x8'
  | 'bayer-16x16'
  | 'blue-noise';

export const DITHER_ALGORITHMS: DitherAlgorithm[] = [
  'threshold',
  'bayer-4x4',
  'bayer-8x8',
  'bayer-16x16',
  'blue-noise',
  'floyd-steinberg',
  'atkinson',
  'jarvis',
  'stucki',
  'burkes',
  'sierra',
  'sierra-2',
  'sierra-lite',
];

export const DEFAULT_DITHER: DitherAlgorithm = 'threshold';

export function isDitherAlgorithm(s: unknown): s is DitherAlgorithm {
  return typeof s === 'string' && (DITHER_ALGORITHMS as string[]).includes(s);
}

// Bayer 有序抖动矩阵（值域 0..n²-1）
const BAYER_4: number[][] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER_8: number[][] = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

// 递归生成 2^k × 2^k Bayer 矩阵（值域 0..n²-1）
function genBayer(n: number): number[][] {
  if (n === 1) return [[0]];
  const half = genBayer(n / 2);
  const h = n / 2;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const v = half[y][x];
      m[y][x] = 4 * v + 0;
      m[y][x + h] = 4 * v + 2;
      m[y + h][x] = 4 * v + 3;
      m[y + h][x + h] = 4 * v + 1;
    }
  }
  return m;
}

const BAYER_16: number[][] = genBayer(16);

interface DiffuseCell {
  dx: number;
  dy: number;
  w: number;
}

// Floyd-Steinberg 误差扩散核（divisor 16）
const FLOYD_STEINBERG: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 7 },
  { dx: -1, dy: 1, w: 3 },
  { dx: 0, dy: 1, w: 5 },
  { dx: 1, dy: 1, w: 1 },
];

// Atkinson 误差扩散核（divisor 8，只扩散 6/8 误差，其余丢弃——这是 Atkinson 的正确行为）
const ATKINSON: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 1 },
  { dx: 2, dy: 0, w: 1 },
  { dx: -1, dy: 1, w: 1 },
  { dx: 0, dy: 1, w: 1 },
  { dx: 1, dy: 1, w: 1 },
  { dx: 0, dy: 2, w: 1 },
];

// Jarvis-Judice-Ninke（divisor 48）
const JARVIS: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 7 }, { dx: 2, dy: 0, w: 5 },
  { dx: -2, dy: 1, w: 3 }, { dx: -1, dy: 1, w: 5 }, { dx: 0, dy: 1, w: 7 }, { dx: 1, dy: 1, w: 5 }, { dx: 2, dy: 1, w: 3 },
  { dx: -2, dy: 2, w: 1 }, { dx: -1, dy: 2, w: 3 }, { dx: 0, dy: 2, w: 5 }, { dx: 1, dy: 2, w: 3 }, { dx: 2, dy: 2, w: 1 },
];

// Stucki（divisor 42）
const STUCKI: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 8 }, { dx: 2, dy: 0, w: 4 },
  { dx: -2, dy: 1, w: 2 }, { dx: -1, dy: 1, w: 4 }, { dx: 0, dy: 1, w: 8 }, { dx: 1, dy: 1, w: 4 }, { dx: 2, dy: 1, w: 2 },
  { dx: -2, dy: 2, w: 1 }, { dx: -1, dy: 2, w: 2 }, { dx: 0, dy: 2, w: 4 }, { dx: 1, dy: 2, w: 2 }, { dx: 2, dy: 2, w: 1 },
];

// Burkes（divisor 32）
const BURKES: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 8 }, { dx: 2, dy: 0, w: 4 },
  { dx: -2, dy: 1, w: 2 }, { dx: -1, dy: 1, w: 4 }, { dx: 0, dy: 1, w: 8 }, { dx: 1, dy: 1, w: 4 }, { dx: 2, dy: 1, w: 2 },
];

// Sierra（Sierra-3，divisor 32）
const SIERRA: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 5 }, { dx: 2, dy: 0, w: 3 },
  { dx: -2, dy: 1, w: 2 }, { dx: -1, dy: 1, w: 4 }, { dx: 0, dy: 1, w: 5 }, { dx: 1, dy: 1, w: 4 }, { dx: 2, dy: 1, w: 2 },
  { dx: -1, dy: 2, w: 2 }, { dx: 0, dy: 2, w: 3 }, { dx: 1, dy: 2, w: 2 },
];

// Sierra Two-Row（divisor 16）
const SIERRA_2: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 4 }, { dx: 2, dy: 0, w: 3 },
  { dx: -2, dy: 1, w: 1 }, { dx: -1, dy: 1, w: 2 }, { dx: 0, dy: 1, w: 3 }, { dx: 1, dy: 1, w: 2 }, { dx: 2, dy: 1, w: 1 },
];

// Sierra Lite（divisor 4）
const SIERRA_LITE: DiffuseCell[] = [
  { dx: 1, dy: 0, w: 2 },
  { dx: -1, dy: 1, w: 1 }, { dx: 0, dy: 1, w: 1 },
];

// 蓝噪声掩码：void-and-cluster (Ulichney 1993)。生成 size×size 的 rank 矩阵（值域 0..size²-1）。
// 懒加载 + memoize（首次用时算一次，~亚秒，之后缓存）。
let _blueNoiseCache: number[][] | null = null;

function getBlueNoiseMatrix(size = 64): number[][] {
  if (_blueNoiseCache) return _blueNoiseCache;
  const N = size * size;
  const sigma = 1.9;
  const energy = new Float64Array(N);
  const pattern = new Uint8Array(N);

  const radius = Math.ceil(3 * sigma);
  const kernel: { dx: number; dy: number; w: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      if (w > 1e-6) kernel.push({ dx, dy, w });
    }
  }

  const wrap = (v: number) => ((v % size) + size) % size;
  const idx = (x: number, y: number) => wrap(y) * size + wrap(x);

  const addPoint = (p: number, sign: number) => {
    const px = p % size;
    const py = (p / size) | 0;
    for (const k of kernel) energy[idx(px + k.dx, py + k.dy)] += sign * k.w;
  };
  const tightestCluster = (): number => {
    let best = -1, bestE = -Infinity;
    for (let i = 0; i < N; i++) if (pattern[i] === 1 && energy[i] > bestE) { bestE = energy[i]; best = i; }
    return best;
  };
  const largestVoid = (): number => {
    let best = -1, bestE = Infinity;
    for (let i = 0; i < N; i++) if (pattern[i] === 0 && energy[i] < bestE) { bestE = energy[i]; best = i; }
    return best;
  };

  // 确定性 RNG
  let rngState = 0x12345678;
  const rand = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

  // 初始放 ~10% 个 1
  const ones = Math.max(1, Math.floor(N / 10));
  let placed = 0;
  while (placed < ones) {
    const p = Math.floor(rand() * N);
    if (pattern[p] === 0) { pattern[p] = 1; addPoint(p, +1); placed++; }
  }

  // 使图样"均匀化"成 prototype：反复 把最紧簇移到最大空洞，直到稳定
  for (let guard = 0; guard < N; guard++) {
    const tc = tightestCluster();
    pattern[tc] = 0; addPoint(tc, -1);
    const lv = largestVoid();
    if (lv === tc) { pattern[tc] = 1; addPoint(tc, +1); break; }
    pattern[lv] = 1; addPoint(lv, +1);
  }

  const proto = pattern.slice();
  const rank = new Int32Array(N).fill(-1);

  // Phase 1：从 prototype 逐个移除最紧簇，rank 从 ones-1 递减到 0
  for (let r = ones - 1; r >= 0; r--) {
    const tc = tightestCluster();
    rank[tc] = r;
    pattern[tc] = 0; addPoint(tc, -1);
  }

  // Phase 2/3：恢复 prototype，逐个往最大空洞填 1，rank 从 ones 递增到 N-1
  pattern.set(proto);
  energy.fill(0);
  for (let i = 0; i < N; i++) if (pattern[i] === 1) addPoint(i, +1);
  for (let r = ones; r < N; r++) {
    const lv = largestVoid();
    rank[lv] = r;
    pattern[lv] = 1; addPoint(lv, +1);
  }

  const matrix: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) row.push(rank[y * size + x]);
    matrix.push(row);
  }
  _blueNoiseCache = matrix;
  return matrix;
}

function orderedDither(
  raw: Uint8Array,
  width: number,
  height: number,
  matrix: number[][],
  n: number,
  out: Uint8Array
): Uint8Array {
  const levels = n * n;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = ((matrix[y % n][x % n] + 0.5) / levels) * 255;
      out[i] = raw[i] >= t ? 255 : 0;
    }
  }
  return out;
}

function errorDiffuse(
  raw: Uint8Array,
  width: number,
  height: number,
  kernel: DiffuseCell[],
  divisor: number,
  out: Uint8Array
): Uint8Array {
  const buf = Float32Array.from(raw);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const oldVal = buf[i];
      const newVal = oldVal < 128 ? 0 : 255;
      out[i] = newVal;
      const err = oldVal - newVal;
      for (const cell of kernel) {
        const nx = x + cell.dx;
        const ny = y + cell.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        buf[ny * width + nx] += (err * cell.w) / divisor;
      }
    }
  }
  return out;
}

/**
 * 将单通道 grayscale raw buffer（每像素 0..255）按指定算法转成 1-bit-ish mono buffer。
 * 返回值每像素是 0（黑/burn）或 255（白）。长度 = width*height。
 */
export function ditherGrayscaleToMono(
  raw: Uint8Array,
  width: number,
  height: number,
  algo: DitherAlgorithm
): Uint8Array {
  const out = new Uint8Array(width * height);
  switch (algo) {
    case 'threshold':
      for (let i = 0; i < raw.length; i++) out[i] = raw[i] >= 128 ? 255 : 0;
      return out;
    case 'bayer-4x4':
      return orderedDither(raw, width, height, BAYER_4, 4, out);
    case 'bayer-8x8':
      return orderedDither(raw, width, height, BAYER_8, 8, out);
    case 'bayer-16x16':
      return orderedDither(raw, width, height, BAYER_16, 16, out);
    case 'blue-noise':
      return orderedDither(raw, width, height, getBlueNoiseMatrix(64), 64, out);
    case 'floyd-steinberg':
      return errorDiffuse(raw, width, height, FLOYD_STEINBERG, 16, out);
    case 'atkinson':
      return errorDiffuse(raw, width, height, ATKINSON, 8, out);
    case 'jarvis':
      return errorDiffuse(raw, width, height, JARVIS, 48, out);
    case 'stucki':
      return errorDiffuse(raw, width, height, STUCKI, 42, out);
    case 'burkes':
      return errorDiffuse(raw, width, height, BURKES, 32, out);
    case 'sierra':
      return errorDiffuse(raw, width, height, SIERRA, 32, out);
    case 'sierra-2':
      return errorDiffuse(raw, width, height, SIERRA_2, 16, out);
    case 'sierra-lite':
      return errorDiffuse(raw, width, height, SIERRA_LITE, 4, out);
    default:
      for (let i = 0; i < raw.length; i++) out[i] = raw[i] >= 128 ? 255 : 0;
      return out;
  }
}
