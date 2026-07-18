import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface ComponentValueProps {
  value: string;    // 主参数，如 "10kΩ" / "100nF" / "220µH"
  package: string;  // 封装，如 "0603" / "0805"
}

interface Props {
  data: ComponentValueProps;
  target: RenderTarget;
  fontFamily: string;
}

// 三种元件符号(电阻/电容/电感)，取自开源 IEC 标准电路符号库
// ElectricalSymbolLibrary(https://github.com/basverdoes/ElectricalSymbolLibrary，
// src/symbols/analog-iec/core/{resistor,capacitor,inductor}.svg，CC0 1.0 公共领域授权，
// 原作者 Filip Dominec 及社区贡献者）。原始描边宽度未加粗(2026-07-19 用户确认按 1 倍使用)，
// 已离线栅格化为透明背景 PNG 并 base64 内嵌，避免运行时额外文件 IO。
const ICON_RESISTOR_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACEAAADICAYAAABmr4glAAABm0lEQVR4nO3b0U0bARRE0bsVxJ3EHWSoLENl2XTgdOJUYB4erQR8IHslBEJzpPl9ug28hf0E/JltHmYrOyyzvUQjQjQiRCNCNCJEI0I0IkQjQjQiRCNCNCJEI0I0IkQjQjQiRCNCNCJEI0I0IkQjQjQiRCNCNCJEI0J8t4iXh+5xmB1nm9PsPLvbc8Rl9qm+ZMTf2cptDrOfs82/2Xl2CwG/ZlfL7DLbPM7MxzPwe3a1zC6zzePMfDzTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I04gwjQjTiDCNCNOIMI0I807ESnaLw+w425xm59ktRHb1NuJTfJmIlX1+zI6zzWn2f3a354i9xOvPqYfZyg7LbC/RiBCNCNGIEI0I0YgQjQjRiBCNCNGIEI0I0YgQjQjRiBCNCNGIEI0I0YgQjQjRiBCNCNGIEI0I0YgQ3yniCQ6L8fNQYbFkAAAAAElFTkSuQmCC';
const ICON_CAPACITOR_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAC8AAADICAYAAAB4ZriWAAACYElEQVR4nO3XwW3WYACDYXsCGIENYASzASMwEiOwCWWDsgEbQCdoHVVVe/Ip7q9IfqQ3x8g55fuIDgH45V58dXc4GV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGV2DsPEZXYOw8Rldg7DxGd0399md6ROA73j1E8BfnOs3/Xh0l7Txt3L58cJzV3N3jL+sjb+Vjb+Vy4//6M4+27yHP8f4f+74gKv5f4y/9B9242/hGP/DfXFn+uDevvPePbgz3R/jG4R3ugY2CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbn9E1CBuf0TUIG5/RNQgbnz0BhZB+4GPoYhwAAAAASUVORK5CYII=';
const ICON_INDUCTOR_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAB0AAADICAYAAAAUYOqTAAAE5klEQVR4nO3XzVEbSRyG8fd/2xvj0+7N4rgnxhG4FYFFBEYRABF4iMAiAosIgAgsIkBEYBGBRQTsM4yEWyOZ7cbTs1Xrfqp+zY23Rh/DYIrPSfqKdUPMFJEhNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqc8GpghNqffdXQqaY5rLBRQF6N+9fhU0jl+Wtej6xaSTnGFrVKNrqsknWEjQ2wlJvgTA0l/4KWmksZ4zvCrFSgxwjF2dY4TPNXFqJ9Tc2Vv0W6MqcjQdQUm+Ai/JfaxNI5UzXEAvzNUxpGqErdo9yblaN0JPsPvMPVoge/wu0g9WrfQ5qf5po/RK3zAukUfo5WkT3iuj9EJjvFcH6MzSe+xrpf39DsKrEs+OpD0DX5nxpGyr3Da7F3K0RN8ht89BsaRooGa+24BvzGmxtF1I3xBAb8bOJGhq+qRTzhBuweUWIh+ZbTAAZyaX1gbaHdDzLTKEFul5opCqq/wSM3997mUo/cYYY6NDLFVChu9whhLbGSIrVLYaN0ch1jI6zWjAzUKlHBqfu5hV0u8w0KrDF1VYqrmE91ujiGW6HR0XaXdL/8FjkSGFI1wiXZDzIwjVRMcw28mhlOOFpjjLfz2U47WOTV/U/1OU4/WPcLvuo/Rmf6DB7OpWv829jFaqfW97WN0qs0rfehj9BYl1vXynj7C7zr16JGahzS/ccrRAt9Q//R7k3L0EiP4XeDIOFJ0pO2XtW4fC+PosgL12AjtznECdTn6ERMUaHcDp1WG2Jx+3EtLDNT8/Fl3cFo9qtQZYqvUuq290A1GWOI5Q2yVwkavMcJWKUeXOMRMrVKOrhtjKi/Dr1SuDNR8N99iV2NMtcrQZZV2vwpLDDFH56N1JabaftJfqLkjJRmtK7DQ9v83Y0yNI1UjXMJvIa425WjdFT7A713q0YGav6l+58aRuiX2sO6mj9GZfvyBqJv3MVqp9d39347OtPny3vUx+g0D/Sj5B6nAd/idpx6d4Bh+hylHnbb/C39AkWq0wC0G2uwMlXF0XT14CafN7lFiaRxdNsIXFGh3iCuoi9H3KOHUjO7qFBM89ZrRIzVP8wVK/FvnOMFzrxmt1LqtvdAYU7UyxFYpbHSCU2yVcrRuquZqNzLE5tQoUOI9XmqOIZZ4ytBFJZyaV2EP7abyrtjQZQM138UDtKvf3wlkSFH9y4/ht8Q+Or8j+c20/X5f4Mg4UjVQ8yHag98b40jZCT7Db5x6tO4Rfhd9jM5xgHU3fYxe4QPWLfoYrdS6bfYxOsExnutjdKbN72sv7+kj/JKPlriF32nq0XqwHvbbTzlaqfWppTuUqUbrq6uvst0QM+PoumNUap4s/G7gRIauGqh50Hba7h4llpAhtgIH+Asl9vA3nHb3AKfmHvzUa0adtv8b+1lbg3UpR+/gtHpJ/VKM3qNS8wS4M0NsTtujD7hamWnH1fl1MTrETBEZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4EZYnPKo4H9A+i5k+3IDN8qAAAAAElFTkSuQmCC';
// 三个图标各自的原始宽高比(width/height)，来自 ElectricalSymbolLibrary 源 SVG 的 viewBox
const ICON_ASPECT: Record<string, number> = {
  resistor: 33 / 200,
  capacitor: 47 / 200,
  inductor: 29 / 200,
};

function iconDataUri(kind: 'resistor' | 'capacitor' | 'inductor'): string {
  const b64 = kind === 'resistor' ? ICON_RESISTOR_B64 : kind === 'capacitor' ? ICON_CAPACITOR_B64 : ICON_INDUCTOR_B64;
  return `data:image/png;base64,${b64}`;
}

/** 按 value 里出现的单位符号猜测元件类型：Ω→电阻，F/f→电容，H/h→电感，默认电阻 */
function detectKind(value: string): 'resistor' | 'capacitor' | 'inductor' {
  if (/Ω/.test(value)) return 'resistor';
  if (/[Ff]/.test(value)) return 'capacitor';
  if (/[Hh]/.test(value)) return 'inductor';
  return 'resistor';
}

// Saira Extra Condensed Bold 的字符前进宽度(advance width / unitsPerEm)，
// 用 fontTools 从 hmtx 表离线提取(2026-07-18)。覆盖数字/常见单位符号/欧姆/微符号/小数点/负号。
const CHAR_WIDTH_RATIO: Record<string, number> = {
  '0': 0.4, '1': 0.267, '2': 0.378, '3': 0.362, '4': 0.393, '5': 0.378,
  '6': 0.392, '7': 0.352, '8': 0.404, '9': 0.392,
  '.': 0.218, '-': 0.27,
  k: 0.37, K: 0.41, n: 0.392, N: 0.439, p: 0.39, P: 0.401,
  m: 0.591, M: 0.611, F: 0.321, f: 0.264, H: 0.436, h: 0.392,
  R: 0.419, r: 0.271, 'Ω': 0.437, 'µ': 0.395, 'μ': 0.395,
};
const DEFAULT_CHAR_WIDTH_RATIO = 0.42;
const CAP_HEIGHT_RATIO = 0.7;

const LEFT_INSET_RATIO = 0.01;
const RIGHT_INSET_RATIO = 0.05;
const V_INSET_RATIO = 0.02;
const MAX_FONT_SIZE = 90;
const PACKAGE_SIZE_RATIO = 0.55;
const GAP_RATIO = 0.1;
const ICON_HEIGHT_RATIO = 0.9;

function measureTextWidthRatio(text: string): number {
  let sum = 0;
  for (const ch of text) {
    sum += CHAR_WIDTH_RATIO[ch] ?? DEFAULT_CHAR_WIDTH_RATIO;
  }
  return sum;
}

export const ComponentValueWidget: React.FC<Props> = ({ data, target, fontFamily }) => {
  const value = (data.value ?? '').trim();
  const packageText = (data.package ?? '').trim().toUpperCase();
  const kind = detectKind(value);

  const leftInset = Math.round(target.widthPx * LEFT_INSET_RATIO);
  const rightInset = Math.round(target.widthPx * RIGHT_INSET_RATIO);
  const vInset = Math.round(target.heightPx * V_INSET_RATIO);

  const safeWidth = target.widthPx - leftInset - rightInset;
  const safeHeight = target.heightPx - vInset * 2;

  const iconH = Math.round(safeHeight * ICON_HEIGHT_RATIO);
  const iconW = Math.round(iconH * ICON_ASPECT[kind]);

  const valueRatioSum = measureTextWidthRatio(value) || 1;
  const packageRatioSum = measureTextWidthRatio(packageText) || 1;
  const denom = valueRatioSum + GAP_RATIO * 2 + PACKAGE_SIZE_RATIO * packageRatioSum;
  const fontSizeByWidth = (safeWidth - iconW) / denom;
  const fontSizeByHeight = safeHeight / CAP_HEIGHT_RATIO;
  const valueFontSize = Math.max(8, Math.floor(Math.min(fontSizeByWidth, fontSizeByHeight, MAX_FONT_SIZE)));
  const packageFontSize = Math.max(6, Math.round(valueFontSize * PACKAGE_SIZE_RATIO));
  const gap = Math.round(valueFontSize * GAP_RATIO);

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
          fontSize: `${valueFontSize}px`,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          display: 'flex',
        }}
      >
        {value}
      </span>
      <img
        src={iconDataUri(kind)}
        width={iconW}
        height={iconH}
        style={{ marginLeft: `${gap}px`, marginRight: `${gap}px`, display: 'flex' }}
      />
      <span
        style={{
          fontSize: `${packageFontSize}px`,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          display: 'flex',
        }}
      >
        {packageText}
      </span>
    </div>
  );
};

export default ComponentValueWidget;
