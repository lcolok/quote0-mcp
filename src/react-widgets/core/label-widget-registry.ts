import React from 'react';
import { TextSingleWidget } from '../components/labels/text-single.js';
import { TextTwoLinesWidget } from '../components/labels/text-two-lines.js';
import { TextWithIconWidget } from '../components/labels/text-with-icon.js';
import { PriceTagWidget } from '../components/labels/price-tag.js';
import { ComponentCodeWidget } from '../components/labels/component-code.js';
import { ComponentValueWidget } from '../components/labels/component-value.js';

export type WidgetId = 'text-single' | 'text-two-lines' | 'text-with-icon' | 'price-tag' | 'component-code' | 'component-value';

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
      { name: 'frameSvgPaths', type: 'string', required: false, description: '可选：装饰 SVG path d 值数组（绝对定位边缘装饰层，画在 widget 整张 viewBox。如 ["M0 0 L320 0 L320 8 ...", "M0 152 L320 152..."] 描述顶/底/4 角等花纹）。中心文字区 (24-296, 24-136) 保持空白避免遮挡' },
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
      { name: 'frameSvgPaths', type: 'string', required: false, description: '可选：装饰 SVG path d 值数组（绝对定位边缘装饰层，画在 widget 整张 viewBox。如 ["M0 0 L320 0 L320 8 ...", "M0 152 L320 152..."] 描述顶/底/4 角等花纹）。中心文字区 (24-296, 24-136) 保持空白避免遮挡' },
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
      { name: 'iconSvg', type: 'string', required: true, description: 'SVG path 的 d 属性值（viewBox 0 0 24 24，单 path 描述完整图案，不要写 <svg> 标签）' },
      { name: 'frameSvgPaths', type: 'string', required: false, description: '可选：装饰 SVG path d 值数组（绝对定位边缘装饰层，画在 widget 整张 viewBox。如 ["M0 0 L320 0 L320 8 ...", "M0 152 L320 152..."] 描述顶/底/4 角等花纹）。中心文字区 (24-296, 24-136) 保持空白避免遮挡' },
    ],
    defaultProps: {
      title: '请勿打扰',
      subtitle: '会议中',
      iconSvg: 'M12 2L2 22h20L12 2zm0 6l6.5 12h-13L12 8z',
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
      { name: 'frameSvgPaths', type: 'string', required: false, description: '可选：装饰 SVG path d 值数组（绝对定位边缘装饰层，画在 widget 整张 viewBox。如 ["M0 0 L320 0 L320 8 ...", "M0 152 L320 152..."] 描述顶/底/4 角等花纹）。中心文字区 (24-296, 24-136) 保持空白避免遮挡' },
    ],
    defaultProps: { title: '番茄', price: '9.9', unit: '元/斤' },
  },
  'component-code': {
    id: 'component-code',
    displayName: 'SMD元件编号',
    description: '窄体大字号打印电子元件料号(如嘉立创 LCSC 编号 C25168826)，左对齐贴边+右侧安全内缩，按位数自动缩放字号。仅支持大写字母+数字(ASCII)，不适合中文内容。',
    component: ComponentCodeWidget,
    propsSchema: [
      { name: 'code', type: 'string', required: true, maxLength: 20, description: '元件编号，如 C25168826(会自动转大写)' },
    ],
    defaultProps: { code: 'C25168826' },
  },
  'component-value': {
    id: 'component-value',
    displayName: 'SMD元件数值+封装',
    description: '主参数(如 10kΩ/100nF/220µH)+封装(如 0603)双字号排版，右侧自动嵌入真实IEC电阻/电容/电感符号(按value单位自动判断元件类型)。仅支持数字/常见单位符号(Ω µ)，不适合中文。',
    component: ComponentValueWidget,
    propsSchema: [
      { name: 'value', type: 'string', required: true, maxLength: 16, description: '主参数，如 "10kΩ"/"100nF"/"220µH"' },
      { name: 'package', type: 'string', required: true, maxLength: 8, description: '封装，如 "0603"/"0805"' },
    ],
    defaultProps: { value: '10kΩ', package: '0603' },
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
  { family: 'saira-extra-condensed', displayName: 'Saira Extra Condensed', description: '极窄无衬线字体，仅含拉丁字母+数字字形，专用于元件编号等纯ASCII窄体场景，不支持中文' },
] as const;

export type SupportedFontFamily = typeof SUPPORTED_FONTS[number]['family'];
