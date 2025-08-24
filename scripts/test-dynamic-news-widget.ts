import { WidgetRenderer } from '../src/react-widgets/core/widget-renderer.js';
import { NewsWidget, NewsData } from '../src/react-widgets/components/NewsWidget.js';

/**
 * 测试动态标题banner渲染
 * 验证不同长度标题的自适应效果
 */
async function testDynamicNewsWidget() {
  console.log('🧪 测试动态新闻标题banner渲染');
  
  const renderer = new WidgetRenderer();
  
  // 测试不同长度的标题
  const testCases = [
    {
      name: '短标题（1行）',
      title: '百度出海',
      expectedLines: 1
    },
    {
      name: '中等标题（1-2行）', 
      title: '英伟达富士通合作富岳',
      expectedLines: 2
    },
    {
      name: '长标题（2-3行）',
      title: '烂番茄评分疑似膨胀研究发现审稿偏见',
      expectedLines: 3
    },
    {
      name: '超长标题（测试截断）',
      title: '天文学家对行星状星云IC 418进行了超过130年的持续观测发现重要演化变化',
      expectedLines: 3
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📝 测试: ${testCase.name}`);
    console.log(`标题: ${testCase.title} (${testCase.title.length}字符)`);
    
    const newsData: NewsData = {
      title: testCase.title,
      message: '这是测试新闻内容。根据标题长度的不同，标题banner会自动调整高度，内容区域也会相应调整大小，确保整体布局保持协调。',
      signature: 'test',
      source: 'Dynamic Title Test',
      category: 'technology'
    };
    
    try {
      const outputPath = await renderer.renderWidget(
        NewsWidget,
        newsData,
        {
          outputPath: `./test-outputs/dynamic-news-${testCase.name.replace(/[^\w]/g, '_')}.png`,
          width: 296,
          height: 152
        }
      );
      
      console.log(`✅ 渲染完成: ${outputPath}`);
      
      // 模拟计算标题布局（与组件内逻辑一致）
      const calculateTitleLayout = (title: string) => {
        const fontSize = 24;
        const charWidth = fontSize * 0.6;
        const maxWidth = 284; // 296 - 12px padding
        const maxCharsPerLine = Math.floor(maxWidth / charWidth);
        const estimatedLines = Math.ceil(title.length / maxCharsPerLine);
        const actualLines = Math.min(estimatedLines, 3);
        const lineHeight = fontSize * 1.1;
        const padding = 8;
        const minHeight = 38;
        const calculatedHeight = Math.max(minHeight, actualLines * lineHeight + padding);
        
        return { lines: actualLines, height: calculatedHeight };
      };
      
      const layout = calculateTitleLayout(testCase.title);
      console.log(`📏 计算结果: ${layout.lines}行, 高度${layout.height}px`);
      console.log(`📊 内容区域: ${152 - layout.height - 16}px`);
      
    } catch (error) {
      console.error(`❌ 渲染失败: ${error}`);
    }
  }
  
  console.log('\n🎯 测试完成！请查看 test-outputs/ 目录下的生成图片');
  console.log('💡 观察要点:');
  console.log('- 短标题应该使用较小的banner高度');
  console.log('- 长标题应该自动扩展到2-3行');
  console.log('- 内容区域高度应该相应调整');
  console.log('- 超长标题应该被截断到3行');
}

// 运行测试
testDynamicNewsWidget().catch(console.error);