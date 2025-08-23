/**
 * 通用组件CLI执行引擎
 * 负责协调插件系统和渲染流程
 */

import React from 'react';
import { WidgetPluginRegistry, WidgetExecutionContext, WidgetExecutionResult, WidgetConfig } from './widget-plugin.js';
import { widgetRenderer } from '../renderer.js';
import { EnvLoader } from '../../image-sender/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

export class WidgetCLIEngine {
  constructor(private registry: WidgetPluginRegistry) {}

  /**
   * 显示总体使用帮助
   */
  showGeneralHelp(): void {
    console.log('🎨 通用小组件生成器');
    console.log('');
    console.log('用法: npm run widget:<type> [参数...]');
    console.log('或: npx tsx src/react-widgets/cli/universal-cli.ts <type> [参数...]');
    console.log('');
    console.log(this.registry.generateHelp());
    console.log('💡 获取特定组件的详细帮助:');
    console.log('  npm run widget:<type> --help');
    console.log('');
  }

  /**
   * 显示特定插件的帮助
   */
  showPluginHelp(type: string): void {
    console.log(this.registry.generatePluginHelp(type));
  }

  /**
   * 执行组件生成任务
   */
  async execute(context: WidgetExecutionContext): Promise<WidgetExecutionResult> {
    const startTime = Date.now();
    
    try {
      // 获取插件
      const plugin = this.registry.get(context.widgetType);
      if (!plugin) {
        throw new Error(`未找到组件类型: ${context.widgetType}`);
      }

      console.log(`🎨 开始生成${plugin.meta.name}组件...`);

      // 解析CLI参数
      const { params, config } = plugin.parseCliArgs(context.args);
      
      // 验证配置
      if (!plugin.validateConfig(config)) {
        throw new Error('组件配置验证失败');
      }

      // 显示执行信息
      this.logExecutionInfo(plugin.meta.name, params, config);

      // 创建组件专用输出目录
      const componentOutputDir = `${context.outputDir}/${plugin.meta.type}`;
      await execAsync(`mkdir -p "${componentOutputDir}"`);

      // 获取数据
      const dataSource = this.extractDataSource(params, plugin);
      console.log(`📊 正在获取${plugin.meta.name}数据 (${dataSource})...`);
      
      const data = await plugin.dataProvider.getData(dataSource, params);
      console.log(`✅ ${plugin.meta.name}数据获取成功`);

      // 渲染组件
      console.log(`🔨 渲染 React ${plugin.meta.name}组件...`);
      const widgetComponent = React.createElement(plugin.component, { data, config });
      
      // 生成输出路径（按组件类型分类存储）
      const outputPath = `${componentOutputDir}/${this.generateFileName(params)}_${context.timestamp}.png`;
      
      // 渲染为图片
      await widgetRenderer.renderToFile(widgetComponent, outputPath);
      
      if (!existsSync(outputPath)) {
        throw new Error('组件渲染失败，图片文件未生成');
      }
      
      console.log('✅ React 组件渲染完成!');
      console.log(`📁 组件图片: ${outputPath}`);

      // 发送到设备 (允许失败)
      const pushSuccess = await this.sendToDevice(outputPath, config, data);

      const executionTime = Date.now() - startTime;
      console.log(`🎉 ${plugin.meta.name}组件生成完成！耗时: ${executionTime}ms`);
      
      if (!pushSuccess) {
        console.log(`⚠️  组件图片已生成，但设备推送失败。图片保存在: ${outputPath}`);
      }

      return {
        success: true,
        outputPath,
        data,
        metadata: {
          executionTime,
          dataSource,
          widgetType: context.widgetType,
          params,
          config
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error('❌ 组件生成失败:', errorMessage);
      
      return {
        success: false,
        error: errorMessage,
        metadata: {
          executionTime,
          dataSource: 'unknown',
          widgetType: context.widgetType
        }
      };
    } finally {
      // 清理资源
      try {
        await widgetRenderer.close();
      } catch (error) {
        // 忽略清理错误
      }
    }
  }

  private logExecutionInfo(widgetName: string, params: any, config: WidgetConfig): void {
    console.log(`📱 组件: ${widgetName}`);
    console.log(`🖼️  边框: ${config.border === '1' ? '黑色' : '白色'}`);
    console.log(`⚙️  参数: ${JSON.stringify(params)}`);
    console.log('');
  }

  private extractDataSource(params: any, plugin: any): string {
    return params.dataSource || plugin.dataProvider.getDefaultSource();
  }

  private generateFileName(params: any): string {
    // 生成基于参数的文件名
    const key = params.city || params.query || params.id || 'default';
    return key.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  }

  private async sendToDevice(outputPath: string, config: WidgetConfig, data?: any): Promise<boolean> {
    try {
      console.log('📤 发送到设备...');
      
      // 自动加载环境变量
      EnvLoader.ensureEnvVars();
      
      // 发送到设备
      const border = config.border || '0';
      let link = data?.link || "";
      
      // 确保链接格式正确
      if (link && link !== "") {
        // 验证链接格式
        try {
          const url = new URL(link);
          console.log(`🔗 链接参数: ${link}`);
          console.log(`🔗 链接验证: 协议=${url.protocol}, 主机=${url.hostname}`);
        } catch (error) {
          console.log(`⚠️  链接格式无效: ${link}`);
          link = ""; // 清空无效链接
        }
      } else {
        console.log(`📝 无链接参数传递`);
      }
      
      const sendCmd = `node dist/image-sender/interfaces/cli/cli-main.js send-server-dither "${outputPath}" "${border}" "${link}" "ORDERED"`;
      
      await execAsync(sendCmd);
      
      console.log('✅ 设备发送完成');
      return true;
    } catch (error) {
      console.log('⚠️  设备推送失败:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}