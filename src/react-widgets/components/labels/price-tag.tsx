import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface PriceTagProps {
  title: string;     // 商品名
  price: string;     // 价格（含小数，如 "9.9"）
  unit: string;      // 单位，如 "元" / "kg" / "盒"
}

interface Props {
  data: PriceTagProps;
  target: RenderTarget;
  fontFamily: string;
}

export const PriceTagWidget: React.FC<Props> = ({ data, target, fontFamily }) => {
  const titleLen = data.title.length || 1;
  const titleByHeight = target.heightPx * 0.2;
  const titleByWidth = target.widthPx / titleLen / 0.7;
  const titleFontSize = Math.floor(Math.min(titleByHeight, titleByWidth, 28));

  const priceLen = data.price.length || 1;
  const priceByHeight = target.heightPx * 0.45;
  const priceByWidth = (target.widthPx * 0.7) / priceLen / 0.7;
  const priceFontSize = Math.floor(Math.min(priceByHeight, priceByWidth, 72));

  const unitByHeight = target.heightPx * 0.18;
  const unitFontSize = Math.floor(Math.min(unitByHeight, 28));

  return (
    <div style={{
      width: `${target.widthPx}px`,
      height: `${target.heightPx}px`,
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px',
      boxSizing: 'border-box',
      gap: '2px',
    }}>
      {/* 商品名 — 上半 30% */}
      <span style={{
        fontSize: `${titleFontSize}px`,
        fontWeight: 700,
        lineHeight: 1.1,
        textAlign: 'center',
      }}>{data.title}</span>

      {/* 价格行 — 下半 70%，大数字 + 小单位 */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '4px',
        lineHeight: 1,
      }}>
        <span style={{
          fontSize: `${priceFontSize}px`,
          fontWeight: 700,
        }}>{data.price}</span>
        <span style={{
          fontSize: `${unitFontSize}px`,
          fontWeight: 400,
        }}>{data.unit}</span>
      </div>
    </div>
  );
};

export default PriceTagWidget;
