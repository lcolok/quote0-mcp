import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface TextWithIconProps {
  title: string;
  subtitle?: string;
  iconSvg: string;  // LLM 生成的 SVG path 的 d 属性值（viewBox 0 0 24 24）字段名沿用历史，内容是 path d
}

interface Props {
  data: TextWithIconProps;
  target: RenderTarget;
  fontFamily: string;
}

export const TextWithIconWidget: React.FC<Props> = ({ data, target, fontFamily }) => {
  // 左侧 icon slot 固定占 heightPx * 0.5（约 80px on 160px label）
  const iconSize = Math.floor(target.heightPx * 0.5);  // ~80px on 160 height

  const titleFontSize = data.subtitle
    ? Math.floor(target.heightPx * 0.32)
    : Math.floor(target.heightPx * 0.5);
  const subtitleFontSize = Math.floor(target.heightPx * 0.18);

  return (
    <div style={{
      width: `${target.widthPx}px`,
      height: `${target.heightPx}px`,
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily,
      display: 'flex',
      alignItems: 'center',
      padding: '8px',
      boxSizing: 'border-box',
      gap: '12px',
    }}>
      {/* 左侧 icon slot — 固定大小，SVG 元素直接 JSX 渲染（satori 不支持 dangerouslySetInnerHTML） */}
      <div style={{
        width: `${iconSize}px`,
        height: `${iconSize}px`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={data.iconSvg} fill="currentColor" stroke="currentColor" strokeWidth={0.3} />
        </svg>
      </div>
      {/* 右侧文字区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '4px',
        overflow: 'hidden',
      }}>
        <span style={{
          fontSize: `${titleFontSize}px`,
          fontWeight: 700,
          lineHeight: 1.1,
        }}>{data.title}</span>
        {data.subtitle && (
          <span style={{
            fontSize: `${subtitleFontSize}px`,
            fontWeight: 400,
            lineHeight: 1.2,
            opacity: 0.85,
          }}>{data.subtitle}</span>
        )}
      </div>
    </div>
  );
};

export default TextWithIconWidget;
