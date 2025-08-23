/**
 * 小组件插件注册表实现
 */

import { WidgetPlugin, WidgetPluginRegistry } from './widget-plugin.js';

export class DefaultWidgetPluginRegistry implements WidgetPluginRegistry {
  private plugins = new Map<string, WidgetPlugin>();

  register(plugin: WidgetPlugin): void {
    if (this.plugins.has(plugin.meta.type)) {
      throw new Error(`Plugin type '${plugin.meta.type}' is already registered`);
    }
    
    // 验证插件基本结构
    this.validatePlugin(plugin);
    
    this.plugins.set(plugin.meta.type, plugin);
    console.log(`✅ 插件注册成功: ${plugin.meta.name} (${plugin.meta.type})`);
  }

  get(type: string): WidgetPlugin | undefined {
    return this.plugins.get(type);
  }

  getAll(): WidgetPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(type: string): boolean {
    return this.plugins.has(type);
  }

  getTypes(): string[] {
    return Array.from(this.plugins.keys());
  }

  private validatePlugin(plugin: WidgetPlugin): void {
    // 验证必需字段
    if (!plugin.meta?.type) {
      throw new Error('Plugin must have a type');
    }
    
    if (!plugin.meta?.name) {
      throw new Error('Plugin must have a name');
    }
    
    if (!plugin.dataProvider) {
      throw new Error('Plugin must have a dataProvider');
    }
    
    if (!plugin.component) {
      throw new Error('Plugin must have a component');
    }
    
    if (typeof plugin.getCliOptions !== 'function') {
      throw new Error('Plugin must implement getCliOptions()');
    }
    
    if (typeof plugin.validateConfig !== 'function') {
      throw new Error('Plugin must implement validateConfig()');
    }
    
    if (typeof plugin.parseCliArgs !== 'function') {
      throw new Error('Plugin must implement parseCliArgs()');
    }
    
    // 验证数据提供者
    const sources = plugin.dataProvider.getSources();
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('Plugin dataProvider must return at least one source');
    }
    
    const defaultSource = plugin.dataProvider.getDefaultSource();
    if (!sources.includes(defaultSource)) {
      throw new Error('Plugin dataProvider default source must be in sources list');
    }
  }

  /**
   * 生成所有插件的帮助信息
   */
  generateHelp(): string {
    const plugins = this.getAll();
    if (plugins.length === 0) {
      return '没有可用的组件插件';
    }

    let help = '🎨 可用的小组件类型:\n\n';
    
    plugins.forEach(plugin => {
      help += `📱 ${plugin.meta.name} (${plugin.meta.type})\n`;
      help += `   ${plugin.meta.description}\n`;
      help += `   数据源: ${plugin.dataProvider.getSources().join(', ')}\n`;
      help += `   默认源: ${plugin.dataProvider.getDefaultSource()}\n\n`;
    });

    return help;
  }

  /**
   * 生成特定插件的详细帮助
   */
  generatePluginHelp(type: string): string {
    const plugin = this.get(type);
    if (!plugin) {
      return `未找到组件类型: ${type}`;
    }

    return plugin.getUsageHelp();
  }
}

// 全局插件注册表单例
export const widgetRegistry = new DefaultWidgetPluginRegistry();