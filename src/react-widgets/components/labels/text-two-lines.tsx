import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface TextTwoLinesProps {
  title: string;
  subtitle: string;
  frameSvgPaths?: string[];  // 新增：装饰 path 数组（绝对定位边缘层）
}

interface Props {
  data: TextTwoLinesProps;
  target: RenderTarget;
  fontFamily: string;
}

export const TextTwoLinesWidget: React.FC<Props> = ({ data, target, fontFamily }) => {
  const titleLen = data.title.length || 1;
  const titleByHeight = target.heightPx * 0.5;      // 主标题占 ~50% 高
  const titleByWidth = target.widthPx / titleLen / 0.7;
  const titleFontSize = Math.floor(Math.min(titleByHeight, titleByWidth, 64));

  const subLen = data.subtitle.length || 1;
  const subByHeight = target.heightPx * 0.25;       // 副标题占 ~25% 高
  const subByWidth = target.widthPx / subLen / 0.7;
  const subtitleFontSize = Math.floor(Math.min(subByHeight, subByWidth, 32));

  return (
    <div style={{
      width: `${target.widthPx}px`,
      height: `${target.heightPx}px`,
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily,
      position: 'relative',  // 新增：让装饰层 absolute 定位以 widget 容器为基准
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px',
      boxSizing: 'border-box',
      gap: '4px',
    }}>
      {/* 装饰层 — 绝对定位铺满，不进入 flexbox layout */}
      {data.frameSvgPaths && data.frameSvgPaths.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${target.widthPx}px`,
          height: `${target.heightPx}px`,
          display: 'flex',  // satori 要求所有 div 用 display: flex
        }}>
          <svg
            width={target.widthPx}
            height={target.heightPx}
            viewBox={`0 0 ${target.widthPx} ${target.heightPx}`}
            xmlns="http://www.w3.org/2000/svg"
          >
            {data.frameSvgPaths.map((d, i) => (
              <path key={i} d={d} fill="currentColor" stroke="currentColor" strokeWidth={1} />
            ))}
          </svg>
        </div>
      )}
      {/* 主内容层 */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{
          fontSize: `${titleFontSize}px`,
          fontWeight: 700,
          lineHeight: 1.1,
          textAlign: 'center',
        }}>{data.title}</span>
        <span style={{
          fontSize: `${subtitleFontSize}px`,
          fontWeight: 400,
          lineHeight: 1.2,
          textAlign: 'center',
          opacity: 0.85,
        }}>{data.subtitle}</span>
      </div>
    </div>
  );
};

export default TextTwoLinesWidget;
