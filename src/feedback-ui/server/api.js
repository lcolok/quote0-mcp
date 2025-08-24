// 简单的Express服务器用于处理反馈数据
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3003;

// 中间件
app.use(cors());
app.use(express.json());

// 确保数据目录存在
const dataDir = path.join(__dirname, '../../../web-feedback-data');
fs.mkdir(dataDir, { recursive: true }).catch(console.error);

// 提交反馈数据
app.post('/api/feedback', async (req, res) => {
  try {
    const feedback = req.body;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `feedback-${timestamp}.json`;
    const filepath = path.join(dataDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(feedback, null, 2));
    
    console.log(`✅ 收到新反馈: ${feedback.reviewer.name} - 整体评分: ${feedback.overallScore}/5`);
    
    res.json({ 
      success: true, 
      message: '反馈提交成功',
      filename: filename
    });
  } catch (error) {
    console.error('保存反馈时出错:', error);
    res.status(500).json({ 
      success: false, 
      error: '服务器错误' 
    });
  }
});

// 获取反馈统计
app.get('/api/stats', async (req, res) => {
  try {
    const files = await fs.readdir(dataDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    let totalFeedbacks = 0;
    let totalScore = 0;
    
    for (const file of jsonFiles) {
      const content = await fs.readFile(path.join(dataDir, file), 'utf-8');
      const feedback = JSON.parse(content);
      totalFeedbacks++;
      totalScore += feedback.overallScore;
    }
    
    const averageScore = totalFeedbacks > 0 ? totalScore / totalFeedbacks : 0;
    
    res.json({
      totalFeedbacks,
      averageScore: Math.round(averageScore * 100) / 100
    });
  } catch (error) {
    console.error('获取统计数据时出错:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 反馈API服务器运行在 http://localhost:${PORT}`);
  console.log(`📁 数据存储目录: ${dataDir}`);
});