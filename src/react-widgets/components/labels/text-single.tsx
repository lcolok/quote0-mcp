import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface TextSingleProps {
  text: string;
  frameSvgPaths?: string[];  // 新增：装饰 path 数组（绝对定位边缘层）
}

interface Props {
  data: TextSingleProps;
  target: RenderTarget;
  fontFamily: string;
}

export const TextSingleWidget: React.FC<Props> = ({ data, target, fontFamily }) => {
  // 字号自适应：根据文字长度 + target 尺寸算
  const textLen = data.text.length || 1;
  const byHeight = target.heightPx * 0.6;
  const byWidth = target.widthPx / textLen / 0.7;  // 0.7 是中文字平均宽高比
  const fontSize = Math.floor(Math.min(byHeight, byWidth, 80));

  return (
    <div style={{
      width: `${target.widthPx}px`,
      height: `${target.heightPx}px`,
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily,
      position: 'relative',  // 新增：让装饰层 absolute 定位以 widget 容器为基准
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px',
      boxSizing: 'border-box',
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
      <span style={{
        fontSize: `${fontSize}px`,
        fontWeight: 700,
        letterSpacing: '0.02em',
        lineHeight: 1,
        position: 'relative',  // 让主内容堆在装饰层之上
        zIndex: 1,
      }}>{data.text}</span>
    </div>
  );
};

export default TextSingleWidget;
