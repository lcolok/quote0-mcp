#!/usr/bin/env tsx
/**
 * AX训练数据快照管理器
 * 支持版本管理、快照创建、版本切换、溯源追踪
 */
export interface TrainingSample {
    sampleId: number;
    title: string;
    newsId: number;
    fingerprint: string;
    newsContent: string;
    optimizedTitle: string;
    optimizedSummary: string;
    annotatedAt: string;
    annotator: string;
    score: number;
    source: string;
    link: string;
    qualityLevel: 'high' | 'medium' | 'low';
}
export interface VersionMetadata {
    version: string;
    createdAt: string;
    createdBy: string;
    description: string;
    aiSummary?: string;
    stats: {
        totalSamples: number;
        highQuality: number;
        mediumQuality: number;
        lowQuality: number;
        avgScore: number;
    };
    sourceBreakdown: Record<string, number>;
    previousVersion: string | null;
    tags: string[];
}
export interface SnapshotVersion {
    version: string;
    path: string;
    createdAt: string;
    sampleCount: number;
    avgScore: number;
}
export declare class SnapshotManager {
    private baseDir;
    private snapshotsDir;
    private modelsDir;
    constructor();
    /**
     * 初始化目录结构
     */
    initialize(): Promise<void>;
    /**
     * 自动生成下一个版本号
     */
    generateNextVersion(): Promise<string>;
    /**
     * 创建新的训练数据快照（自动版本号）
     */
    createSnapshot(samples: TrainingSample[], description?: string, createdBy?: string, tags?: string[]): Promise<string>;
    /**
     * 列出所有版本
     */
    listVersions(): Promise<SnapshotVersion[]>;
    /**
     * 获取版本详细信息
     */
    getVersionDetails(version: string): Promise<{
        metadata: VersionMetadata;
        samples: TrainingSample[];
        sourceMapping: any[];
    } | null>;
    /**
     * 激活指定版本（切换为当前使用的训练数据）
     */
    activateVersion(version: string): Promise<void>;
    /**
     * 获取当前激活的版本
     */
    getCurrentVersion(): Promise<string | null>;
    /**
     * 比较两个版本的差异
     */
    compareVersions(v1: string, v2: string): Promise<{
        added: number;
        removed: number;
        modified: number;
        sampleCountDiff: number;
        scoreDiff: number;
    }>;
    private calculateStats;
    private calculateSourceBreakdown;
    /**
     * 更新版本描述（用户备注）
     */
    updateVersionDescription(version: string, newDescription: string): Promise<void>;
    /**
     * 生成AI总结
     */
    generateAISummary(samples: TrainingSample[], stats: any, previousVersion: string | null): Promise<string>;
}
//# sourceMappingURL=snapshot-manager.d.ts.map