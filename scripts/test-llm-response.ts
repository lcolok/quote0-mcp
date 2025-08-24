#!/usr/bin/env tsx

import { EnvLoader } from '../src/image-sender/adapters/environments/env-loader.js';
import { LLMProcessorFactory, LLMConfig } from '../src/react-widgets/services/llm-content-processor.js';

async function testLLMResponse() {
  // 加载环境变量
  EnvLoader.load();
  
  const llmConfig: LLMConfig = {
    provider: (process.env.LLM_PROVIDER as any) || 'mock',
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL || 'gpt-5-mini',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '300'),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7')
  };
  
  console.log(`🔧 测试LLM: ${llmConfig.provider}/${llmConfig.model}`);
  
  const processor = LLMProcessorFactory.create(llmConfig);
  
  const testTitle = "FFmpeg 8.0 释出";
  const prompt = `请优化以下新闻标题，要求：
1. 长度严格控制在10个中文字符以内
2. 保持核心信息完整
3. 使用简洁有力的表达
4. 适合水墨屏快速阅读

原标题：${testTitle}

请直接输出优化后的标题，不要任何额外说明：`;

  try {
    console.log('🤖 发送请求...');
    const response = await processor.process(testTitle, prompt, {
      maxLength: 20,
      style: 'concise',
      focus: 'summary'
    });
    
    console.log('📝 原始响应:');
    console.log('Title:', JSON.stringify(response.title));
    console.log('Summary:', JSON.stringify(response.summary));
    console.log('全部响应:', JSON.stringify(response, null, 2));
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testLLMResponse().catch(console.error);