import iconNodes from 'lucide-static/icon-nodes.json' assert { type: 'json' };

type IconNode = [string, Record<string, string | number>];
type IconData = IconNode[];
const ICONS: Record<string, IconData> = iconNodes as any;

export class DecoratorDrawingAPI {
  private paths: string[] = [];

  // ====== 几何 primitives ======

  line(x1: number, y1: number, x2: number, y2: number): this {
    this.paths.push(`M${this.f(x1)} ${this.f(y1)} L${this.f(x2)} ${this.f(y2)}`);
    return this;
  }

  /** 4 段 cubic bezier 近似圆（k = 0.5523 是单位圆 4 段贝塞尔的标准控制点距离系数） */
  circle(cx: number, cy: number, r: number): this {
    const k = 0.5522847498;
    const ck = r * k;
    this.paths.push(
      `M${this.f(cx - r)} ${this.f(cy)} ` +
      `C${this.f(cx - r)} ${this.f(cy - ck)} ${this.f(cx - ck)} ${this.f(cy - r)} ${this.f(cx)} ${this.f(cy - r)} ` +
      `C${this.f(cx + ck)} ${this.f(cy - r)} ${this.f(cx + r)} ${this.f(cy - ck)} ${this.f(cx + r)} ${this.f(cy)} ` +
      `C${this.f(cx + r)} ${this.f(cy + ck)} ${this.f(cx + ck)} ${this.f(cy + r)} ${this.f(cx)} ${this.f(cy + r)} ` +
      `C${this.f(cx - ck)} ${this.f(cy + r)} ${this.f(cx - r)} ${this.f(cy + ck)} ${this.f(cx - r)} ${this.f(cy)} Z`
    );
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number): this {
    const k = 0.5522847498;
    const ckx = rx * k;
    const cky = ry * k;
    this.paths.push(
      `M${this.f(cx - rx)} ${this.f(cy)} ` +
      `C${this.f(cx - rx)} ${this.f(cy - cky)} ${this.f(cx - ckx)} ${this.f(cy - ry)} ${this.f(cx)} ${this.f(cy - ry)} ` +
      `C${this.f(cx + ckx)} ${this.f(cy - ry)} ${this.f(cx + rx)} ${this.f(cy - cky)} ${this.f(cx + rx)} ${this.f(cy)} ` +
      `C${this.f(cx + rx)} ${this.f(cy + cky)} ${this.f(cx + ckx)} ${this.f(cy + ry)} ${this.f(cx)} ${this.f(cy + ry)} ` +
      `C${this.f(cx - ckx)} ${this.f(cy + ry)} ${this.f(cx - rx)} ${this.f(cy + cky)} ${this.f(cx - rx)} ${this.f(cy)} Z`
    );
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.paths.push(`M${this.f(x)} ${this.f(y)} H${this.f(x + w)} V${this.f(y + h)} H${this.f(x)} Z`);
    return this;
  }

  /** 正多边形：cx,cy 中心，r 半径，n 边数 */
  polygon(cx: number, cy: number, r: number, n: number): this {
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      d += (i === 0 ? 'M' : 'L') + this.f(x) + ' ' + this.f(y) + ' ';
    }
    d += 'Z';
    this.paths.push(d);
    return this;
  }

  /** 五角星 */
  star(cx: number, cy: number, r: number, points = 5, innerRatio = 0.4): this {
    let d = '';
    const innerR = r * innerRatio;
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      const rad = i % 2 === 0 ? r : innerR;
      const x = cx + rad * Math.cos(a);
      const y = cy + rad * Math.sin(a);
      d += (i === 0 ? 'M' : 'L') + this.f(x) + ' ' + this.f(y) + ' ';
    }
    d += 'Z';
    this.paths.push(d);
    return this;
  }

  /** 心形 — 经典 cubic bezier */
  heart(cx: number, cy: number, r: number): this {
    const s = r;
    this.paths.push(
      `M${this.f(cx)} ${this.f(cy + s * 0.7)} ` +
      `C${this.f(cx - s * 1.4)} ${this.f(cy - s * 0.2)} ${this.f(cx - s * 1.4)} ${this.f(cy - s * 1.2)} ${this.f(cx)} ${this.f(cy - s * 0.5)} ` +
      `C${this.f(cx + s * 1.4)} ${this.f(cy - s * 1.2)} ${this.f(cx + s * 1.4)} ${this.f(cy - s * 0.2)} ${this.f(cx)} ${this.f(cy + s * 0.7)} Z`
    );
    return this;
  }

  /** 五瓣花（或任意瓣数） */
  flower(cx: number, cy: number, r: number, petals = 5): this {
    let d = '';
    for (let i = 0; i < petals; i++) {
      const a = (i * 2 * Math.PI) / petals;
      const tipX = cx + r * Math.cos(a);
      const tipY = cy + r * Math.sin(a);
      const cp1x = cx + r * 0.5 * Math.cos(a - 0.5);
      const cp1y = cy + r * 0.5 * Math.sin(a - 0.5);
      const cp2x = cx + r * 0.5 * Math.cos(a + 0.5);
      const cp2y = cy + r * 0.5 * Math.sin(a + 0.5);
      d += `M${this.f(cx)} ${this.f(cy)} Q${this.f(cp1x)} ${this.f(cp1y)} ${this.f(tipX)} ${this.f(tipY)} Q${this.f(cp2x)} ${this.f(cp2y)} ${this.f(cx)} ${this.f(cy)} `;
    }
    this.paths.push(d);
    return this;
  }

  // ====== 重复 pattern helpers ======

  dashedLine(x1: number, y1: number, x2: number, y2: number, dashLen = 4, gap = 2): this {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return this;
    const ux = dx / len;
    const uy = dy / len;
    let pos = 0;
    let d = '';
    while (pos < len) {
      const sx = x1 + ux * pos;
      const sy = y1 + uy * pos;
      const ex = x1 + ux * Math.min(pos + dashLen, len);
      const ey = y1 + uy * Math.min(pos + dashLen, len);
      d += `M${this.f(sx)} ${this.f(sy)} L${this.f(ex)} ${this.f(ey)} `;
      pos += dashLen + gap;
    }
    this.paths.push(d);
    return this;
  }

  /** 沿直线散点（多个小圆点） */
  dots(x1: number, y1: number, x2: number, y2: number, count: number, radius = 1.5): this {
    if (count < 2) count = 2;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = x1 + t * (x2 - x1);
      const y = y1 + t * (y2 - y1);
      this.circle(x, y, radius);
    }
    return this;
  }

  /** 沿直线珠串（圆点更大） */
  pearls(x1: number, y1: number, x2: number, y2: number, count: number, radius = 3): this {
    return this.dots(x1, y1, x2, y2, count, radius);
  }

  /** 锯齿 */
  zigzag(x1: number, y1: number, x2: number, y2: number, amplitude = 3, teeth = 8): this {
    let d = `M${this.f(x1)} ${this.f(y1)}`;
    for (let i = 1; i <= teeth; i++) {
      const t = i / teeth;
      const baseX = x1 + t * (x2 - x1);
      const baseY = y1 + t * (y2 - y1);
      const offsetY = i % 2 === 0 ? 0 : amplitude;
      d += ` L${this.f(baseX)} ${this.f(baseY + offsetY)}`;
    }
    this.paths.push(d);
    return this;
  }

  /** 正弦波 */
  wave(x1: number, y1: number, x2: number, y2: number, amplitude = 4, cycles = 4): this {
    const steps = cycles * 16;
    let d = `M${this.f(x1)} ${this.f(y1)}`;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const baseX = x1 + t * (x2 - x1);
      const baseY = y1 + t * (y2 - y1);
      const offsetY = Math.sin(t * cycles * 2 * Math.PI) * amplitude;
      d += ` L${this.f(baseX)} ${this.f(baseY + offsetY)}`;
    }
    this.paths.push(d);
    return this;
  }

  // ====== Lucide icon 系统 ======

  /** 渲染 lucide icon at (x, y) with size px, optional rotate degrees */
  icon(name: string, x: number, y: number, size: number, opts: { rotate?: number } = {}): this {
    const nodes = ICONS[name];
    if (!nodes) {
      console.warn(`⚠️ lucide icon not found: ${name}`);
      return this;
    }
    const scale = size / 24;
    const rotateRad = ((opts.rotate ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rotateRad);
    const sin = Math.sin(rotateRad);
    // icon 中心相对 24x24 viewBox 是 (12, 12)
    // 放置后中心位于 (x + size/2, y + size/2)
    const cx = x + size / 2;
    const cy = y + size / 2;
    // transform: 把 24x24 viewBox 内的点 (vx, vy) 映射到画布坐标
    // vx' = vx - 12 (中心化); vy' = vy - 12
    // vx'' = vx' * scale * cos - vy' * scale * sin  (旋转)
    // vy'' = vx' * scale * sin + vy' * scale * cos
    // final: cx + vx'', cy + vy''
    const transform = (vx: number, vy: number): [number, number] => {
      const dx = (vx - 12) * scale;
      const dy = (vy - 12) * scale;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };

    for (const [tag, attrs] of nodes as IconNode[]) {
      const pathD = nodeToPathD(tag, attrs);
      if (!pathD) continue;
      const transformed = transformPathD(pathD, transform);
      this.paths.push(transformed);
    }
    return this;
  }

  /** 直接 push 一条 path d（高级用户 escape hatch） */
  push(pathD: string): this {
    this.paths.push(pathD);
    return this;
  }

  getPaths(): string[] {
    return [...this.paths];
  }

  /** 数字格式化：保留 2 位小数 */
  private f(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
}

// ====== helpers ======

/** SVG node tag → path d 转换 */
function nodeToPathD(tag: string, attrs: any): string | null {
  switch (tag) {
    case 'path':
      return typeof attrs.d === 'string' ? attrs.d : null;
    case 'circle': {
      const cx = parseFloat(attrs.cx);
      const cy = parseFloat(attrs.cy);
      const r = parseFloat(attrs.r);
      if (isNaN(cx) || isNaN(cy) || isNaN(r)) return null;
      const k = 0.5522847498;
      const ck = r * k;
      return (
        `M${cx - r} ${cy} ` +
        `C${cx - r} ${cy - ck} ${cx - ck} ${cy - r} ${cx} ${cy - r} ` +
        `C${cx + ck} ${cy - r} ${cx + r} ${cy - ck} ${cx + r} ${cy} ` +
        `C${cx + r} ${cy + ck} ${cx + ck} ${cy + r} ${cx} ${cy + r} ` +
        `C${cx - ck} ${cy + r} ${cx - r} ${cy + ck} ${cx - r} ${cy} Z`
      );
    }
    case 'rect': {
      const x = parseFloat(attrs.x ?? 0);
      const y = parseFloat(attrs.y ?? 0);
      const w = parseFloat(attrs.width);
      const h = parseFloat(attrs.height);
      if (isNaN(w) || isNaN(h)) return null;
      return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
    }
    case 'line': {
      const x1 = parseFloat(attrs.x1);
      const y1 = parseFloat(attrs.y1);
      const x2 = parseFloat(attrs.x2);
      const y2 = parseFloat(attrs.y2);
      if ([x1, y1, x2, y2].some(isNaN)) return null;
      return `M${x1} ${y1} L${x2} ${y2}`;
    }
    case 'polygon':
    case 'polyline': {
      if (typeof attrs.points !== 'string') return null;
      const pts = attrs.points
        .trim()
        .split(/[\s,]+/)
        .map(parseFloat);
      if (pts.length < 4 || pts.some(isNaN)) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) {
        d += ` L${pts[i]} ${pts[i + 1]}`;
      }
      if (tag === 'polygon') d += ' Z';
      return d;
    }
    case 'ellipse': {
      const cx = parseFloat(attrs.cx);
      const cy = parseFloat(attrs.cy);
      const rx = parseFloat(attrs.rx);
      const ry = parseFloat(attrs.ry);
      if ([cx, cy, rx, ry].some(isNaN)) return null;
      const k = 0.5522847498;
      const ckx = rx * k;
      const cky = ry * k;
      return (
        `M${cx - rx} ${cy} ` +
        `C${cx - rx} ${cy - cky} ${cx - ckx} ${cy - ry} ${cx} ${cy - ry} ` +
        `C${cx + ckx} ${cy - ry} ${cx + rx} ${cy - cky} ${cx + rx} ${cy} ` +
        `C${cx + rx} ${cy + cky} ${cx + ckx} ${cy + ry} ${cx} ${cy + ry} ` +
        `C${cx - ckx} ${cy + ry} ${cx - rx} ${cy + cky} ${cx - rx} ${cy} Z`
      );
    }
    default:
      return null;
  }
}

/** 把 path d 字符串内所有绝对坐标应用 transform。
 *  注意：lucide icon 数据 path 几乎都是 mixed case (M Q L 等绝对/相对)；
 *  我们先 absolutize 所有命令 再 transform，最后输出全部绝对坐标。
 */
function transformPathD(d: string, transform: (vx: number, vy: number) => [number, number]): string {
  // 1. tokenize: split into commands + numbers
  const tokens: Array<string | number> = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(parseFloat(match[2]));
  }

  // 2. absolutize + transform
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0; // for Z command
  let cmd = '';
  let i = 0;
  const out: Array<string | number> = [];

  const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(3));

  const applyT = (x: number, y: number): [number, number] => transform(x, y);

  while (i < tokens.length) {
    const tk = tokens[i];
    if (typeof tk === 'string') {
      cmd = tk;
      i++;
      continue;
    }
    // tk 是数字 → 根据 cmd 处理
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    switch (upper) {
      case 'M':
      case 'L':
      case 'T': {
        let x = tokens[i] as number;
        let y = tokens[i + 1] as number;
        if (isRel) {
          x += curX;
          y += curY;
        }
        const [tx, ty] = applyT(x, y);
        out.push(upper, fmt(tx), fmt(ty));
        curX = x;
        curY = y;
        if (upper === 'M') {
          startX = x;
          startY = y;
        }
        i += 2;
        cmd = upper === 'M' ? 'L' : upper === 'L' ? 'L' : 'T'; // 后续隐式
        break;
      }
      case 'H': {
        let x = tokens[i] as number;
        if (isRel) x += curX;
        const [tx, ty] = applyT(x, curY);
        out.push('L', fmt(tx), fmt(ty)); // H 旋转后变成普通 L（因为 rotate 改变了水平方向）
        curX = x;
        i += 1;
        break;
      }
      case 'V': {
        let y = tokens[i] as number;
        if (isRel) y += curY;
        const [tx, ty] = applyT(curX, y);
        out.push('L', fmt(tx), fmt(ty));
        curY = y;
        i += 1;
        break;
      }
      case 'C': {
        let x1 = tokens[i] as number;
        let y1 = tokens[i + 1] as number;
        let x2 = tokens[i + 2] as number;
        let y2 = tokens[i + 3] as number;
        let x = tokens[i + 4] as number;
        let y = tokens[i + 5] as number;
        if (isRel) {
          x1 += curX;
          y1 += curY;
          x2 += curX;
          y2 += curY;
          x += curX;
          y += curY;
        }
        const [tx1, ty1] = applyT(x1, y1);
        const [tx2, ty2] = applyT(x2, y2);
        const [tx, ty] = applyT(x, y);
        out.push('C', fmt(tx1), fmt(ty1), fmt(tx2), fmt(ty2), fmt(tx), fmt(ty));
        curX = x;
        curY = y;
        i += 6;
        break;
      }
      case 'S':
      case 'Q': {
        let x1 = tokens[i] as number;
        let y1 = tokens[i + 1] as number;
        let x = tokens[i + 2] as number;
        let y = tokens[i + 3] as number;
        if (isRel) {
          x1 += curX;
          y1 += curY;
          x += curX;
          y += curY;
        }
        const [tx1, ty1] = applyT(x1, y1);
        const [tx, ty] = applyT(x, y);
        out.push(upper, fmt(tx1), fmt(ty1), fmt(tx), fmt(ty));
        curX = x;
        curY = y;
        i += 4;
        break;
      }
      case 'A': {
        // 椭圆弧：rx ry x-axis-rotation large-arc-flag sweep-flag x y
        // 简化：不做 rotate 调整（如果 LLM icon 真用了 A 命令，rotate 后可能略错；多数 lucide 用 cubic 曲线）
        let rx = tokens[i] as number;
        let ry = tokens[i + 1] as number;
        let xAxisRot = tokens[i + 2] as number;
        let largeFlag = tokens[i + 3] as number;
        let sweepFlag = tokens[i + 4] as number;
        let x = tokens[i + 5] as number;
        let y = tokens[i + 6] as number;
        if (isRel) {
          x += curX;
          y += curY;
        }
        const [tx, ty] = applyT(x, y);
        // 粗略估算 scale（假设 transform 是 uniform scale + rotate + translate）
        const [t1x, t1y] = applyT(1, 0);
        const [t0x, t0y] = applyT(0, 0);
        const scale = Math.sqrt((t1x - t0x) ** 2 + (t1y - t0y) ** 2);
        out.push('A', fmt(rx * Math.abs(scale)), fmt(ry * Math.abs(scale)), fmt(xAxisRot), fmt(largeFlag), fmt(sweepFlag), fmt(tx), fmt(ty));
        curX = x;
        curY = y;
        i += 7;
        break;
      }
      case 'Z': {
        out.push('Z');
        curX = startX;
        curY = startY;
        i += 1;
        break;
      }
      default:
        // unknown command, skip
        i += 1;
        break;
    }
  }

  return out.join(' ');
}
