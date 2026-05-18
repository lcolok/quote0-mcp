import React from 'react';
import type { RenderTarget } from '../../core/render-targets.js';

export interface TextSingleProps {
  text: string;
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
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px',
      boxSizing: 'border-box',
    }}>
      <span style={{
        fontSize: `${fontSize}px`,
        fontWeight: 700,
        letterSpacing: '0.02em',
        lineHeight: 1,
      }}>{data.text}</span>
    </div>
  );
};

export default TextSingleWidget;
