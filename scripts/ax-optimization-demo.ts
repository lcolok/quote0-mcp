import { AxOptimizedNewsProcessor } from '../src/react-widgets/services/ax-optimized-news-processor.js';

/**
 * AX自动优化演示脚本
 * 展示AX框架的真正威力：自动学习和优化
 */
async function runAxOptimizationDemo() {
  console.log('🚀 AX框架自动优化演示开始');

  // 1. 创建优化处理器
  const processor = new AxOptimizedNewsProcessor({
    apiKey: process.env.LLM_API_KEY!,
    baseURL: process.env.LLM_BASE_URL!,
    model: 'gpt-5-mini'
  });

  // 2. 准备训练数据（这是让AX学习的关键！）
  const trainingData = [
    {
      newsContent: '英伟达和富士通宣布合作开发下一代超级计算机"富岳NEXT"，预计算力达到1 Zetta，计划2030年前后投入使用。英伟达将提供GPU加速技术，富士通负责系统设计。',
      expectedTitle: '英伟达富士通合作富岳',
      expectedSummary: '英伟达与富士通合作开发"富岳NEXT"超算，目标1 Zetta算力，2030年投用。英伟达提供GPU，富士通负责设计。'
    },
    {
      newsContent: '百度计划将其自动驾驶出租车服务扩展到海外市场，首批目标市场包括东南亚和中东地区。该公司已在中国10多个城市运营自动驾驶出租车服务。',
      expectedTitle: '百度自驾出租车出海',
      expectedSummary: '百度计划将自动驾驶出租车扩展至东南亚、中东等海外市场。已在中国10多城市运营相关服务。'
    },
    {
      newsContent: 'Arch Linux官方宣布其主要基础设施正在遭受持续的DDoS攻击，影响了官方网站、AUR和论坛的正常访问。团队正在与托管商合作缓解攻击。',
      expectedTitle: 'Arch Linux遭DDoS',
      expectedSummary: 'Arch Linux基础设施遭持续DDoS攻击，影响官网、AUR、论坛访问。团队与托管商合作应对。'
    },
    {
      newsContent: '研究发现审稿人如果在论文中发现引用了自己的工作，更可能批准该论文发表。对18,400篇开放获取论文的分析显示这种偏见确实存在。',
      expectedTitle: '审稿人引用偏见研究',
      expectedSummary: '研究显示审稿人发现论文引用自己工作时更易批准发表。基于18,400篇开放获取论文的分析证实此偏见。'
    },
    {
      newsContent: '烂番茄网站被Fandango收购后，评分系统出现可能的膨胀现象。分析显示收购后新增的影评人多来自小型媒体，可能更容易受到公关影响。',
      expectedTitle: '烂番茄评分疑膨胀',
      expectedSummary: '烂番茄被Fandango收购后评分疑似膨胀。新增影评人多来自小媒体，或更易受公关影响。'
    }
  ];

  console.log('📚 开始AX自动优化训练...');

  try {
    // 3. 运行自动优化（这是AX的核心功能！）
    const optimizationResult = await processor.trainOptimizedPrograms(trainingData);
    
    console.log('✅ 优化训练完成:', optimizationResult);

    // 4. 测试优化效果
    console.log('\n🧪 测试优化后的程序效果:');
    
    const testNews = '天文学家对行星状星云IC 418进行了超过130年的持续观测，发现其中心恒星温度自1893年以来上升了约3000°C，绿光强度增加了2.5倍，这是罕见的长期恒星演化观测记录。';
    
    const result = await processor.processNewsWithOptimizedProgram(testNews);
    
    console.log('📊 优化后的处理结果:');
    console.log('标题:', result.title);
    console.log('摘要:', result.body);
    console.log('来源:', result.footer);

    // 5. 展示中间产物的威力
    console.log('\n💾 AX生成的中间产物已保存到: ax-optimization-artifacts/');
    console.log('这些产物包含了:');
    console.log('- 优化后的few-shot示例');
    console.log('- 自动生成的最佳指令提示词');  
    console.log('- 调优后的模型参数');
    console.log('- 完整的优化统计数据');

  } catch (error) {
    console.error('❌ 演示过程出错:', error);
  }
}

// 运行演示
runAxOptimizationDemo().catch(console.error);