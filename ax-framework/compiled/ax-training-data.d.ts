/**
 * AX框架训练数据集
 * 高质量的新闻处理示例，用于自动优化训练
 */
export interface TrainingExample {
    newsContent: string;
    expectedTitle: string;
    expectedSummary: string;
    metadata?: {
        category: string;
        difficulty: number;
        quality: number;
    };
}
export declare const trainingData: TrainingExample[];
/**
 * 训练数据评价指标
 */
export declare const evaluationCriteria: {
    title: {
        maxLength: number;
        minLength: number;
        weights: {
            lengthCompliance: number;
            informationDensity: number;
            readability: number;
        };
    };
    summary: {
        maxLength: number;
        minLength: number;
        weights: {
            lengthCompliance: number;
            accuracy: number;
            completeness: number;
        };
    };
};
//# sourceMappingURL=ax-training-data.d.ts.map