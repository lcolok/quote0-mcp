import React from 'react';
import { RenderTarget } from '../core/render-targets.js';

export interface LabelData {
  title: string;
  subtitle?: string;
}

interface LabelWidgetProps {
  data: LabelData;
  target: RenderTarget;
  fontFamily?: string;
}

export const LabelWidget: React.FC<LabelWidgetProps> = ({ data, target, fontFamily }) => {
  const titleLen = data.title.length;
  const titleZone = data.subtitle ? target.heightPx * 0.55 : target.heightPx * 0.75;
  const byHeight = titleZone;
  const byWidth = target.widthPx / titleLen / 0.6;
  const finalFontSize = Math.floor(Math.min(byHeight, byWidth));
  const subtitleSize = data.subtitle ? Math.floor(finalFontSize * 0.4) : 0;

  const containerStyle: React.CSSProperties = {
    width: `${target.widthPx}px`,
    height: `${target.heightPx}px`,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: fontFamily || target.defaultFontStack[0] || 'sans-serif',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    boxSizing: 'border-box',
    padding: '4px',
    overflow: 'hidden',
  };

  const titleStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: `${finalFontSize}px`,
    fontWeight: 700,
    lineHeight: '1.1',
    textAlign: 'center',
    wordBreak: 'keep-all',
  };

  const subtitleStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: `${subtitleSize}px`,
    fontWeight: 400,
    lineHeight: '1.2',
    textAlign: 'center',
    marginTop: '4px',
    wordBreak: 'keep-all',
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{data.title}</div>
      {data.subtitle && <div style={subtitleStyle}>{data.subtitle}</div>}
    </div>
  );
};

export default LabelWidget;
