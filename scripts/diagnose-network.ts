#!/usr/bin/env tsx

/**
 * 网络连接诊断工具
 * 分析中国气象局API的连接问题
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface NetworkDiagnostic {
  test: string;
  success: boolean;
  result: string;
  error?: string;
  timing?: number;
}

class NetworkDiagnostics {
  private readonly baseUrl = 'https://weather.cma.cn/api/now';
  private readonly testCode = '59287'; // 广州站
  private readonly fullUrl = `${this.baseUrl}/${this.testCode}`;

  async runAllDiagnostics(): Promise<void> {
    console.log('🔍 中国气象局API网络连接诊断');
    console.log('================================');
    console.log(`🎯 测试URL: ${this.fullUrl}`);
    console.log('');

    const diagnostics: NetworkDiagnostic[] = [];

    // 1. DNS解析测试
    diagnostics.push(await this.testDNS());
    
    // 2. 基础连通性测试
    diagnostics.push(await this.testPing());
    
    // 3. SSL/TLS测试
    diagnostics.push(await this.testSSL());
    
    // 4. HTTP连接测试
    diagnostics.push(await this.testHTTP());
    
    // 5. 不同User-Agent测试
    diagnostics.push(await this.testUserAgents());
    
    // 6. Node.js fetch测试
    diagnostics.push(await this.testNodeFetch());
    
    // 7. 超时和重试测试
    diagnostics.push(await this.testTimeouts());

    // 输出诊断结果
    console.log('\n📊 诊断结果汇总:');
    console.log('==================');
    
    diagnostics.forEach((diagnostic, index) => {
      const status = diagnostic.success ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${diagnostic.test}`);
      if (diagnostic.timing) {
        console.log(`   ⏱️  耗时: ${diagnostic.timing}ms`);
      }
      if (diagnostic.result) {
        console.log(`   📝 结果: ${diagnostic.result}`);
      }
      if (diagnostic.error) {
        console.log(`   ⚠️  错误: ${diagnostic.error}`);
      }
      console.log('');
    });

    // 分析和建议
    this.analyzeResults(diagnostics);
  }

  private async testDNS(): Promise<NetworkDiagnostic> {
    console.log('1. 🌐 DNS解析测试...');
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('nslookup weather.cma.cn');
      const timing = Date.now() - startTime;
      
      console.log(`   DNS解析成功 (${timing}ms)`);
      return {
        test: 'DNS解析',
        success: true,
        result: stdout.split('\n').slice(-3).join(' ').trim(),
        timing
      };
    } catch (error) {
      return {
        test: 'DNS解析',
        success: false,
        result: 'DNS解析失败',
        error: (error as Error).message
      };
    }
  }

  private async testPing(): Promise<NetworkDiagnostic> {
    console.log('2. 📡 连通性测试...');
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('ping -c 3 weather.cma.cn');
      const timing = Date.now() - startTime;
      
      // 提取平均延迟
      const avgMatch = stdout.match(/avg = ([\d.]+)/);
      const avgPing = avgMatch ? avgMatch[1] + 'ms' : '未知';
      
      console.log(`   连通性正常，平均延迟: ${avgPing}`);
      return {
        test: '网络连通性',
        success: true,
        result: `平均延迟: ${avgPing}`,
        timing
      };
    } catch (error) {
      return {
        test: '网络连通性',
        success: false,
        result: '无法ping通服务器',
        error: (error as Error).message
      };
    }
  }

  private async testSSL(): Promise<NetworkDiagnostic> {
    console.log('3. 🔒 SSL/TLS测试...');
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('openssl s_client -connect weather.cma.cn:443 -servername weather.cma.cn < /dev/null 2>/dev/null | grep -E "(Protocol|Cipher)"');
      const timing = Date.now() - startTime;
      
      console.log(`   SSL连接成功 (${timing}ms)`);
      return {
        test: 'SSL/TLS连接',
        success: true,
        result: stdout.trim(),
        timing
      };
    } catch (error) {
      return {
        test: 'SSL/TLS连接',
        success: false,
        result: 'SSL握手失败',
        error: (error as Error).message
      };
    }
  }

  private async testHTTP(): Promise<NetworkDiagnostic> {
    console.log('4. 🌐 HTTP连接测试...');
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync(`curl -I -s -m 10 "${this.fullUrl}" -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"`);
      const timing = Date.now() - startTime;
      
      const statusLine = stdout.split('\n')[0];
      console.log(`   HTTP请求成功: ${statusLine} (${timing}ms)`);
      
      return {
        test: 'HTTP头部请求',
        success: true,
        result: statusLine,
        timing
      };
    } catch (error) {
      return {
        test: 'HTTP头部请求',
        success: false,
        result: 'HTTP请求失败',
        error: (error as Error).message
      };
    }
  }

  private async testUserAgents(): Promise<NetworkDiagnostic> {
    console.log('5. 👤 不同User-Agent测试...');
    const startTime = Date.now();
    
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'curl/7.68.0',
      'WeatherApp/1.0'
    ];
    
    const results = [];
    
    for (const ua of userAgents) {
      try {
        const { stdout } = await execAsync(`curl -I -s -m 5 "${this.fullUrl}" -H "User-Agent: ${ua}"`);
        const statusCode = stdout.split('\n')[0].match(/\d{3}/)?.[0];
        results.push(`${ua.split('/')[0]}: ${statusCode}`);
      } catch (error) {
        results.push(`${ua.split('/')[0]}: 失败`);
      }
    }
    
    const timing = Date.now() - startTime;
    console.log(`   User-Agent测试完成 (${timing}ms)`);
    
    return {
      test: 'User-Agent兼容性',
      success: results.some(r => r.includes('200')),
      result: results.join(', '),
      timing
    };
  }

  private async testNodeFetch(): Promise<NetworkDiagnostic> {
    console.log('6. 🟢 Node.js fetch测试...');
    const startTime = Date.now();
    
    try {
      // 使用和代码中相同的配置
      const response = await fetch(this.fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        signal: AbortSignal.timeout(10000),
      });
      
      const timing = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json();
        console.log(`   Node.js fetch成功 (${timing}ms)`);
        return {
          test: 'Node.js fetch',
          success: true,
          result: `状态码: ${response.status}, 数据码: ${data.code}`,
          timing
        };
      } else {
        return {
          test: 'Node.js fetch',
          success: false,
          result: `HTTP ${response.status}: ${response.statusText}`,
          timing
        };
      }
    } catch (error) {
      const timing = Date.now() - startTime;
      return {
        test: 'Node.js fetch',
        success: false,
        result: 'fetch请求失败',
        error: (error as Error).message,
        timing
      };
    }
  }

  private async testTimeouts(): Promise<NetworkDiagnostic> {
    console.log('7. ⏱️  超时和重试测试...');
    const startTime = Date.now();
    
    const timeouts = [5000, 10000, 15000]; // 5秒, 10秒, 15秒
    const results = [];
    
    for (const timeout of timeouts) {
      try {
        console.log(`   测试 ${timeout/1000}s 超时...`);
        const response = await fetch(this.fullUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(timeout),
        });
        
        if (response.ok) {
          results.push(`${timeout/1000}s: 成功`);
          break;
        } else {
          results.push(`${timeout/1000}s: HTTP ${response.status}`);
        }
      } catch (error) {
        results.push(`${timeout/1000}s: ${(error as Error).name}`);
      }
      
      // 等待1秒再试下一个超时值
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const timing = Date.now() - startTime;
    
    return {
      test: '超时配置',
      success: results.some(r => r.includes('成功')),
      result: results.join(', '),
      timing
    };
  }

  private analyzeResults(diagnostics: NetworkDiagnostic[]): void {
    console.log('🔍 问题分析和建议:');
    console.log('==================');
    
    const failures = diagnostics.filter(d => !d.success);
    
    if (failures.length === 0) {
      console.log('✅ 所有测试都通过！网络连接正常。');
      console.log('💡 间歇性错误可能是由于:');
      console.log('   • 服务器负载高');
      console.log('   • 网络拥塞');
      console.log('   • 临时的防火墙规则');
      return;
    }
    
    console.log(`❌ 发现 ${failures.length} 个问题:`);
    
    failures.forEach(failure => {
      console.log(`\n🔴 ${failure.test}:`);
      console.log(`   问题: ${failure.result}`);
      if (failure.error) {
        console.log(`   详情: ${failure.error}`);
      }
      
      // 针对不同问题提供建议
      if (failure.test.includes('DNS')) {
        console.log('💡 建议: 尝试更换DNS服务器 (如8.8.8.8, 114.114.114.114)');
      } else if (failure.test.includes('SSL')) {
        console.log('💡 建议: SSL问题，可能需要更新系统证书或使用代理');
      } else if (failure.test.includes('fetch')) {
        console.log('💡 建议: 尝试增加超时时间或使用HTTP代理');
      }
    });
    
    console.log('\n🛠️  推荐解决方案:');
    console.log('1. 增加重试次数和超时时间');
    console.log('2. 使用指数退避策略');
    console.log('3. 添加请求间隔以避免限流');
    console.log('4. 考虑使用HTTP代理');
    console.log('5. 实现更好的错误处理和降级方案');
  }
}

async function main() {
  try {
    const diagnostics = new NetworkDiagnostics();
    await diagnostics.runAllDiagnostics();
  } catch (error) {
    console.error('诊断过程出错:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}