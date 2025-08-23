#!/usr/bin/env tsx

/**
 * 中国气象局API稳定性监控
 * 连续测试API响应时间和成功率
 */

import { getWeatherForCityRobust } from '../src/react-widgets/services/robust-weather-service.js';

interface ApiTest {
  timestamp: Date;
  success: boolean;
  duration: number;
  error?: string;
  city: string;
  temperature?: number;
}

class ApiStabilityMonitor {
  private testResults: ApiTest[] = [];
  private readonly testCities = ['广州', '北京', '上海', '杭州', '深圳'];
  private isRunning = false;

  async startMonitoring(testCount: number = 20, intervalMs: number = 5000): Promise<void> {
    console.log('📊 中国气象局API稳定性监控');
    console.log('============================');
    console.log(`🎯 测试次数: ${testCount}`);
    console.log(`⏱️  测试间隔: ${intervalMs/1000}秒`);
    console.log(`🌍 测试城市: ${this.testCities.join(', ')}`);
    console.log('');

    this.isRunning = true;

    for (let i = 1; i <= testCount && this.isRunning; i++) {
      const city = this.testCities[(i - 1) % this.testCities.length];
      
      console.log(`🧪 测试 ${i}/${testCount}: ${city}`);
      await this.performTest(city, i);
      
      // 显示实时统计
      if (i % 5 === 0) {
        this.showStatistics();
      }
      
      // 等待下一次测试
      if (i < testCount) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    this.showFinalReport();
  }

  private async performTest(city: string, testNumber: number): Promise<void> {
    const startTime = Date.now();
    
    try {
      const weatherData = await getWeatherForCityRobust(city);
      const duration = Date.now() - startTime;
      
      const result: ApiTest = {
        timestamp: new Date(),
        success: true,
        duration,
        city,
        temperature: weatherData.temperature
      };
      
      this.testResults.push(result);
      console.log(`   ✅ 成功 (${duration}ms) - ${weatherData.city} ${weatherData.temperature}°C`);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      const result: ApiTest = {
        timestamp: new Date(),
        success: false,
        duration,
        city,
        error: (error as Error).message
      };
      
      this.testResults.push(result);
      console.log(`   ❌ 失败 (${duration}ms) - ${(error as Error).message}`);
    }
  }

  private showStatistics(): void {
    const total = this.testResults.length;
    const successful = this.testResults.filter(r => r.success).length;
    const failed = total - successful;
    const successRate = ((successful / total) * 100).toFixed(1);
    
    const durations = this.testResults.filter(r => r.success).map(r => r.duration);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    console.log(`\n📊 阶段性统计 (${total}次测试):`);
    console.log(`   成功率: ${successRate}% (${successful}/${total})`);
    console.log(`   失败数: ${failed}`);
    console.log(`   响应时间: 平均${avgDuration}ms, 最快${minDuration}ms, 最慢${maxDuration}ms`);
    console.log('');
  }

  private showFinalReport(): void {
    console.log('\n🎉 最终监控报告');
    console.log('================');
    
    const total = this.testResults.length;
    const successful = this.testResults.filter(r => r.success).length;
    const failed = total - successful;
    const successRate = ((successful / total) * 100).toFixed(1);
    
    console.log(`📈 总体统计:`);
    console.log(`   总测试数: ${total}`);
    console.log(`   成功次数: ${successful}`);
    console.log(`   失败次数: ${failed}`);
    console.log(`   成功率: ${successRate}%`);
    
    if (successful > 0) {
      const durations = this.testResults.filter(r => r.success).map(r => r.duration);
      const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);
      const medianDuration = this.calculateMedian(durations);
      
      console.log(`\n⏱️  响应时间分析:`);
      console.log(`   平均响应时间: ${avgDuration}ms`);
      console.log(`   最快响应时间: ${minDuration}ms`);
      console.log(`   最慢响应时间: ${maxDuration}ms`);
      console.log(`   中位响应时间: ${medianDuration}ms`);
      
      // 响应时间分布
      const fastCount = durations.filter(d => d < 3000).length;
      const normalCount = durations.filter(d => d >= 3000 && d < 10000).length;
      const slowCount = durations.filter(d => d >= 10000).length;
      
      console.log(`\n📊 响应时间分布:`);
      console.log(`   快速 (<3s): ${fastCount} (${((fastCount/successful)*100).toFixed(1)}%)`);
      console.log(`   正常 (3-10s): ${normalCount} (${((normalCount/successful)*100).toFixed(1)}%)`);
      console.log(`   缓慢 (>10s): ${slowCount} (${((slowCount/successful)*100).toFixed(1)}%)`);
    }
    
    if (failed > 0) {
      console.log(`\n❌ 失败原因分析:`);
      const errorTypes = new Map<string, number>();
      
      this.testResults.filter(r => !r.success).forEach(r => {
        const errorType = this.categorizeError(r.error || '');
        errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
      });
      
      for (const [error, count] of errorTypes) {
        console.log(`   ${error}: ${count}次 (${((count/failed)*100).toFixed(1)}%)`);
      }
    }
    
    console.log(`\n💡 建议:`);
    if (parseFloat(successRate) >= 90) {
      console.log(`   ✅ API非常稳定 (${successRate}%成功率)`);
    } else if (parseFloat(successRate) >= 70) {
      console.log(`   ⚠️ API基本稳定，建议增加重试机制`);
    } else {
      console.log(`   🔴 API不稳定，需要实现更好的错误处理`);
    }
    
    const avgDuration = successful > 0 ? this.testResults.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful : 0;
    if (avgDuration < 5000) {
      console.log(`   🚀 响应速度良好 (平均${Math.round(avgDuration)}ms)`);
    } else {
      console.log(`   🐌 响应较慢，建议增加超时时间`);
    }
  }

  private calculateMedian(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  private categorizeError(error: string): string {
    if (error.includes('timeout') || error.includes('AbortError')) {
      return '请求超时';
    } else if (error.includes('fetch failed') || error.includes('ECONNRESET')) {
      return '网络连接失败';
    } else if (error.includes('500')) {
      return '服务器内部错误';
    } else if (error.includes('429')) {
      return '请求频率限制';
    } else {
      return '其他错误';
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('⏹️ 监控已停止');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const testCount = parseInt(args[0]) || 20;
  const intervalMs = parseInt(args[1]) || 5000;

  const monitor = new ApiStabilityMonitor();

  // 处理Ctrl+C中断
  process.on('SIGINT', () => {
    console.log('\n\n🛑 收到中断信号，正在停止监控...');
    monitor.stop();
  });

  try {
    await monitor.startMonitoring(testCount, intervalMs);
  } catch (error) {
    console.error('监控过程出错:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}