export interface ReviewerInfo {
  name: string;
  expertise: 'journalism' | 'ai-ml' | 'technology' | 'linguistics' | 'other';
  experience: number;
}

export interface TitleFeedback {
  score: number;
  lengthAppropriate: boolean;
  informationComplete: boolean;
  readabilityGood: boolean;
  accuracyGood: boolean;
  suggestions?: string;
  improvedVersion?: string;
}

export interface SummaryFeedback {
  score: number;
  lengthAppropriate: boolean;
  accuracyGood: boolean;
  completenessGood: boolean;
  clarityGood: boolean;
  suggestions?: string;
  improvedVersion?: string;
}

export interface ExpertAnnotations {
  keyEntities: string[];
  coreEvents: string[];
  importance: 'high' | 'medium' | 'low';
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface AIOutput {
  title: string;
  summary: string;
  processingTime?: number;
}

export interface NewsInput {
  originalNews: string;
  category: 'technology' | 'finance' | 'politics' | 'sports' | 'entertainment' | 'other';
}

export interface HumanFeedback {
  taskId: string;
  timestamp: string;
  input: NewsInput;
  aiOutput: AIOutput;
  reviewer: ReviewerInfo;
  overallScore: number;
  titleFeedback: TitleFeedback;
  summaryFeedback: SummaryFeedback;
  expertAnnotations: ExpertAnnotations;
  comments?: string;
}

export interface FeedbackStats {
  totalFeedbacks: number;
  averageScores: {
    overall: number;
    title: number;
    summary: number;
  };
  qualityTrend: number[];
  recentImprovement: number;
}