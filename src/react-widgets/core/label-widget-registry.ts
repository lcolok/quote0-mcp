import React from 'react';
import { TextSingleWidget, TextSingleProps } from '../components/labels/text-single.js';
import { TextTwoLinesWidget, TextTwoLinesProps } from '../components/labels/text-two-lines.js';
import { TextWithIconWidget, TextWithIconProps } from '../components/labels/text-with-icon.js';
import { PriceTagWidget, PriceTagProps } from '../components/labels/price-tag.js';

export type WidgetId = 'text-single' | 'text-two-lines' | 'text-with-icon' | 'price-tag';

export interface WidgetPropsSchemaField {
  name: string;
  type: 'string';
  required: boolean;
  maxLength?: number;
  description: string;
}

export interface WidgetMeta {
  id: WidgetId;
  displayName: string;
  description: string;
  propsSchema: WidgetPropsSchemaField[];
  component: React.ComponentType<any>;
  defaultProps: Record<string, any>;
}

export const WIDGETS: Record<WidgetId, WidgetMeta> = {
  'text-single': {
    id: 'text-single',
    displayName: '单行大字',
    description: '一行居中大字，适合招牌/门牌/简单命令',
    component: TextSingleWidget,
    propsSchema: [
      { name: 'text', type: 'string', required: true, maxLength: 12, description: '文字内容（≤12 字最佳）' },
    ],
    defaultProps: { text: '会议室 A' },
  },
  'text-two-lines': {
    id: 'text-two-lines',
    displayName: '主副双行',
    description: '主标题 + 副标题，适合命名 + 编号',
    component: TextTwoLinesWidget,
    propsSchema: [
      { name: 'title', type: 'string', required: true, maxLength: 10, description: '主标题（大字）' },
      { name: 'subtitle', type: 'string', required: true, maxLength: 20, description: '副标题（小字）' },
    ],
    defaultProps: { title: '会议室 A', subtitle: '2F-201' },
  },
  'text-with-icon': {
    id: 'text-with-icon',
    displayName: '图标+文字',
    description: '左侧图标 + 右侧文字两行，适合告示/提示卡片',
    component: TextWithIconWidget,
    propsSchema: [
      { name: 'title', type: 'string', required: true, maxLength: 10, description: '主标题' },
      { name: 'subtitle', type: 'string', required: false, maxLength: 16, description: '副标题（可选）' },
      { name: 'iconSvg', type: 'string', required: true, description: 'SVG viewBox="0 0 24 24"，会被注入到 80×80 icon slot' },
    ],
    defaultProps: {
      title: '请勿打扰',
      subtitle: '会议中',
      iconSvg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 22h20L12 2zm0 6l6.5 12h-13L12 8z" fill="currentColor"/></svg>',
    },
  },
  'price-tag': {
    id: 'price-tag',
    displayName: '价签',
    description: '商品名 + 大价格 + 单位，适合零售/超市',
    component: PriceTagWidget,
    propsSchema: [
      { name: 'title', type: 'string', required: true, maxLength: 10, description: '商品名' },
      { name: 'price', type: 'string', required: true, maxLength: 8, description: '价格数字（如 "9.9"）' },
      { name: 'unit', type: 'string', required: true, maxLength: 4, description: '单位（如 "元/斤"）' },
    ],
    defaultProps: { title: '番茄', price: '9.9', unit: '元/斤' },
  },
};

export function getWidget(id: string): WidgetMeta | undefined {
  return WIDGETS[id as WidgetId];
}

export function listWidgets(): Array<Omit<WidgetMeta, 'component'>> {
  return Object.values(WIDGETS).map(({ component, ...meta }) => meta);
}

export const SUPPORTED_FONTS = [
  { family: 'smiley-sans', displayName: '得意黑', description: '活泼斜体黑体，适合时尚/标识' },
  { family: 'lxgw-wenkai', displayName: '霞鹜文楷 Medium', description: '楷体，适合诗词/文学/优雅场景' },
  { family: 'alibaba-puhuiti', displayName: '阿里普惠 Heavy', description: '极粗黑体，适合公告/价签/庄重' },
] as const;

export type SupportedFontFamily = typeof SUPPORTED_FONTS[number]['family'];
