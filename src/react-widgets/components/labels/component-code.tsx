import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface ComponentCodeProps {
  code: string;
}

interface Props {
  data: ComponentCodeProps;
  target: RenderTarget;
  fontFamily: string;
}

// Saira Extra Condensed Bold 的字符前进宽度(advance width / unitsPerEm)，
// 用 fontTools 从 assets/fonts/saira-extra-condensed/SairaExtraCondensed-Bold.ttf 的
// hmtx 表离线提取(2026-07-18)，只覆盖大写字母+数字(LCSC 料号字符集)。
// 缺失字符(小写/符号)退回 DEFAULT_CHAR_WIDTH_RATIO 保守估计。
const CHAR_WIDTH_RATIO: Record<string, number> = {
  A: 0.422, B: 0.41, C: 0.323, D: 0.416, E: 0.345, F: 0.321, G: 0.408, H: 0.436,
  I: 0.21, J: 0.245, K: 0.41, L: 0.311, M: 0.611, N: 0.439, O: 0.423, P: 0.401,
  Q: 0.423, R: 0.419, S: 0.368, T: 0.349, U: 0.426, V: 0.404, W: 0.643, X: 0.421,
  Y: 0.387, Z: 0.362,
  '0': 0.4, '1': 0.267, '2': 0.378, '3': 0.362, '4': 0.393, '5': 0.378,
  '6': 0.392, '7': 0.352, '8': 0.404, '9': 0.392,
};
const DEFAULT_CHAR_WIDTH_RATIO = 0.42;
// 字形可见高度 / fontSize 的经验比例，2026-07-18 实机打印校准(fontSize=69 时实测 naturalH=48px, 48/69≈0.7)
const CAP_HEIGHT_RATIO = 0.7;

// 安全边距占 target 宽/高的比例。右边距明显大于其余三边——
// 2026-07-18 实测：四边等距内缩会把最右侧字符顶出打印机可打印区域，
// 改成"左/上/下贴边、只在右边留足内缩"后实机验证通过。
const LEFT_INSET_RATIO = 0.01;
const RIGHT_INSET_RATIO = 0.05;
const V_INSET_RATIO = 0.02;
const MAX_FONT_SIZE = 90;

function measureTextWidthRatio(code: string): number {
  let sum = 0;
  for (const ch of code) {
    sum += CHAR_WIDTH_RATIO[ch] ?? DEFAULT_CHAR_WIDTH_RATIO;
  }
  return sum;
}

export const ComponentCodeWidget: React.FC<Props> = ({ data, target, fontFamily }) => {
  const code = (data.code ?? '').toUpperCase();
  const leftInset = Math.round(target.widthPx * LEFT_INSET_RATIO);
  const rightInset = Math.round(target.widthPx * RIGHT_INSET_RATIO);
  const vInset = Math.round(target.heightPx * V_INSET_RATIO);

  const safeWidth = target.widthPx - leftInset - rightInset;
  const safeHeight = target.heightPx - vInset * 2;

  const widthRatioSum = measureTextWidthRatio(code) || 1;
  const fontSizeByWidth = safeWidth / widthRatioSum;
  const fontSizeByHeight = safeHeight / CAP_HEIGHT_RATIO;
  const fontSize = Math.max(8, Math.floor(Math.min(fontSizeByWidth, fontSizeByHeight, MAX_FONT_SIZE)));

  return (
    <div
      style={{
        width: `${target.widthPx}px`,
        height: `${target.heightPx}px`,
        backgroundColor: '#ffffff',
        color: '#000000',
        fontFamily,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingLeft: `${leftInset}px`,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: `${fontSize}px`,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          display: 'flex',
        }}
      >
        {code}
      </span>
    </div>
  );
};

export default ComponentCodeWidget;
