import { create } from 'zustand';
import { HumanFeedback, NewsInput, AIOutput, FeedbackStats } from '../types/feedback';

interface FeedbackStore {
  // 当前评估的数据
  currentNews: NewsInput | null;
  currentAIOutput: AIOutput | null;
  
  // 反馈历史
  feedbacks: HumanFeedback[];
  stats: FeedbackStats;
  
  // 当前表单状态
  currentFeedback: Partial<HumanFeedback>;
  isSubmitting: boolean;
  
  // Actions
  setCurrentData: (news: NewsInput, aiOutput: AIOutput) => void;
  updateCurrentFeedback: (feedback: Partial<HumanFeedback>) => void;
  submitFeedback: () => Promise<boolean>;
  loadMockData: () => void;
  calculateStats: () => void;
}

export const useFeedbackStore = create<FeedbackStore>((set, get) => ({
  // Initial state
  currentNews: null,
  currentAIOutput: null,
  feedbacks: [],
  stats: {
    totalFeedbacks: 0,
    averageScores: { overall: 0, title: 0, summary: 0 },
    qualityTrend: [],
    recentImprovement: 0
  },
  currentFeedback: {},
  isSubmitting: false,
  
  // Actions
  setCurrentData: (news, aiOutput) => {
    set({
      currentNews: news,
      currentAIOutput: aiOutput,
      currentFeedback: {
        taskId: `task_${Date.now()}`,
        timestamp: new Date().toISOString(),
        input: news,
        aiOutput: aiOutput
      }
    });
  },
  
  updateCurrentFeedback: (feedback) => {
    set(state => ({
      currentFeedback: { ...state.currentFeedback, ...feedback }
    }));
  },
  
  submitFeedback: async () => {
    set({ isSubmitting: true });
    
    try {
      const { currentFeedback, feedbacks } = get();
      const completeFeedback = currentFeedback as HumanFeedback;
      
      // 提交到API服务器
      try {
        const response = await fetch('http://localhost:3003/api/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(completeFeedback)
        });
        
        if (!response.ok) {
          throw new Error('API提交失败');
        }
        
        console.log('✅ 反馈已提交到AX训练系统');
      } catch (apiError) {
        console.warn('API提交失败，使用本地存储:', apiError);
      }
      
      // 添加到本地历史记录
      const newFeedbacks = [...feedbacks, completeFeedback];
      
      set({ 
        feedbacks: newFeedbacks,
        currentFeedback: {},
        isSubmitting: false 
      });
      
      // 重新计算统计数据
      get().calculateStats();
      
      // 保存到本地存储作为备份
      localStorage.setItem('ax-feedbacks', JSON.stringify(newFeedbacks));
      
      return true;
    } catch (error) {
      console.error('提交反馈失败:', error);
      set({ isSubmitting: false });
      return false;
    }
  },
  
  loadMockData: () => {
    // 加载模拟新闻数据
    const mockNews: NewsInput = {
      originalNews: 'SpaceX成功发射最新一批Starlink卫星，本次任务搭载60颗卫星，使在轨卫星总数达到5000颗。马斯克表示，Starlink网络现已覆盖全球99%的人口，下载速度可达1Gbps。该服务已在50多个国家提供，用户超过300万。SpaceX计划未来五年内将卫星数量增加到12000颗。',
      category: 'technology'
    };
    
    const mockAIOutput: AIOutput = {
      title: 'SpaceX发射Starlink卫星达5000颗',
      summary: 'SpaceX发射60颗Starlink卫星，总数达5000颗，网络覆盖全球99%人口，速度达1Gbps，用户超300万，计划5年内增至12000颗。',
      processingTime: 2340
    };
    
    get().setCurrentData(mockNews, mockAIOutput);
    
    // 从本地存储加载历史反馈
    const stored = localStorage.getItem('ax-feedbacks');
    if (stored) {
      try {
        const feedbacks = JSON.parse(stored);
        set({ feedbacks });
        get().calculateStats();
      } catch (error) {
        console.error('加载历史数据失败:', error);
      }
    }
  },
  
  calculateStats: () => {
    const { feedbacks } = get();
    
    if (feedbacks.length === 0) {
      set({
        stats: {
          totalFeedbacks: 0,
          averageScores: { overall: 0, title: 0, summary: 0 },
          qualityTrend: [],
          recentImprovement: 0
        }
      });
      return;
    }
    
    const averageScores = {
      overall: feedbacks.reduce((sum, f) => sum + f.overallScore, 0) / feedbacks.length,
      title: feedbacks.reduce((sum, f) => sum + f.titleFeedback.score, 0) / feedbacks.length,
      summary: feedbacks.reduce((sum, f) => sum + f.summaryFeedback.score, 0) / feedbacks.length
    };
    
    const qualityTrend = feedbacks.map(f => f.overallScore);
    
    // 计算最近改进程度
    const recentFeedbacks = feedbacks.slice(-5);
    const earlyFeedbacks = feedbacks.slice(0, 5);
    const recentAvg = recentFeedbacks.reduce((sum, f) => sum + f.overallScore, 0) / recentFeedbacks.length;
    const earlyAvg = earlyFeedbacks.reduce((sum, f) => sum + f.overallScore, 0) / earlyFeedbacks.length;
    const recentImprovement = recentAvg - earlyAvg;
    
    set({
      stats: {
        totalFeedbacks: feedbacks.length,
        averageScores,
        qualityTrend,
        recentImprovement
      }
    });
  }
}));