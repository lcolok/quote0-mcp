#!/usr/bin/env tsx
/**
 * AX训练数据快照管理器
 * 支持版本管理、快照创建、版本切换、溯源追踪
 */
import fs from 'fs/promises';
import path from 'path';
export class SnapshotManager {
    baseDir;
    snapshotsDir;
    modelsDir;
    constructor() {
        this.baseDir = path.join(process.cwd(), 'ax-framework');
        this.snapshotsDir = path.join(this.baseDir, 'training-snapshots');
        this.modelsDir = path.join(this.baseDir, 'models', 'snapshots');
    }
    /**
     * 初始化目录结构
     */
    async initialize() {
        await fs.mkdir(this.snapshotsDir, { recursive: true });
        await fs.mkdir(this.modelsDir, { recursive: true });
        await fs.mkdir(path.join(this.baseDir, 'models', 'production'), { recursive: true });
        console.log('✅ 快照管理器初始化完成');
    }
    /**
     * 自动生成下一个版本号
     */
    async generateNextVersion() {
        const versions = await this.listVersions();
        if (versions.length === 0) {
            return 'v1';
        }
        // 提取版本号并排序
        const versionNumbers = versions
            .map(v => {
            const match = v.version.match(/^v(\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
        })
            .filter(n => n > 0);
        const maxVersion = Math.max(...versionNumbers, 0);
        return `v${maxVersion + 1}`;
    }
    /**
     * 创建新的训练数据快照（自动版本号）
     */
    async createSnapshot(samples, description = '', createdBy = 'system', tags = []) {
        // 自动生成版本号
        const version = await this.generateNextVersion();
        const timestamp = new Date().toISOString().split('T')[0];
        const versionDir = path.join(this.snapshotsDir, `${version}_${timestamp}`);
        await fs.mkdir(versionDir, { recursive: true });
        // 计算统计信息
        const stats = this.calculateStats(samples);
        const sourceBreakdown = this.calculateSourceBreakdown(samples);
        const previousVersion = await this.getCurrentVersion();
        // 生成AI总结
        const aiSummary = await this.generateAISummary(samples, stats, previousVersion);
        // 创建元数据
        const metadata = {
            version,
            createdAt: new Date().toISOString(),
            createdBy,
            description,
            aiSummary,
            stats,
            sourceBreakdown,
            previousVersion,
            tags
        };
        // 创建溯源映射
        const sourceMapping = samples.map((sample, index) => ({
            sampleId: index + 1,
            title: sample.title,
            newsId: sample.newsId,
            fingerprint: sample.fingerprint,
            annotatedAt: sample.annotatedAt,
            annotator: sample.annotator,
            score: sample.score,
            source: sample.source,
            link: sample.link,
            qualityLevel: sample.qualityLevel
        }));
        // 保存文件
        await fs.writeFile(path.join(versionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
        await fs.writeFile(path.join(versionDir, 'samples.json'), JSON.stringify(samples, null, 2));
        await fs.writeFile(path.join(versionDir, 'source-mapping.json'), JSON.stringify(sourceMapping, null, 2));
        console.log(`✅ 创建快照成功: ${version}`);
        console.log(`📁 位置: ${versionDir}`);
        console.log(`📊 样本数: ${samples.length}`);
        console.log(`⭐ 平均分: ${stats.avgScore.toFixed(1)}`);
        return version; // 返回版本号而非目录路径
    }
    /**
     * 列出所有版本
     */
    async listVersions() {
        const entries = await fs.readdir(this.snapshotsDir);
        const versions = [];
        for (const entry of entries) {
            const versionPath = path.join(this.snapshotsDir, entry);
            const stat = await fs.stat(versionPath);
            if (stat.isDirectory()) {
                const metadataPath = path.join(versionPath, 'metadata.json');
                try {
                    const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
                    const metadata = JSON.parse(metadataRaw);
                    versions.push({
                        version: metadata.version,
                        path: versionPath,
                        createdAt: metadata.createdAt,
                        sampleCount: metadata.stats.totalSamples,
                        avgScore: metadata.stats.avgScore
                    });
                }
                catch (error) {
                    console.warn(`⚠️ 无法读取版本 ${entry} 的元数据`);
                }
            }
        }
        return versions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    /**
     * 获取版本详细信息
     */
    async getVersionDetails(version) {
        const versions = await this.listVersions();
        const targetVersion = versions.find(v => v.version === version);
        if (!targetVersion) {
            return null;
        }
        const metadata = JSON.parse(await fs.readFile(path.join(targetVersion.path, 'metadata.json'), 'utf-8'));
        const samples = JSON.parse(await fs.readFile(path.join(targetVersion.path, 'samples.json'), 'utf-8'));
        const sourceMapping = JSON.parse(await fs.readFile(path.join(targetVersion.path, 'source-mapping.json'), 'utf-8'));
        return { metadata, samples, sourceMapping };
    }
    /**
     * 激活指定版本（切换为当前使用的训练数据）
     */
    async activateVersion(version) {
        const details = await this.getVersionDetails(version);
        if (!details) {
            throw new Error(`版本 ${version} 不存在`);
        }
        // 转换为 ax-training-data.js 格式
        const trainingData = details.samples.map(sample => ({
            newsContent: sample.newsContent,
            expectedTitle: sample.optimizedTitle,
            expectedSummary: sample.optimizedSummary
        }));
        const jsContent = `/**
 * AX框架训练数据 - 自动生成
 * 版本: ${version}
 * 生成时间: ${new Date().toISOString()}
 * 样本数量: ${trainingData.length}
 */

export const trainingData = ${JSON.stringify(trainingData, null, 2)};
`;
        const targetPath = path.join(this.baseDir, 'compiled', 'ax-training-data.js');
        await fs.writeFile(targetPath, jsContent);
        // 更新版本指针
        const versionPointer = {
            currentVersion: version,
            activatedAt: new Date().toISOString(),
            sampleCount: trainingData.length
        };
        await fs.writeFile(path.join(this.baseDir, 'models', 'production', 'version.json'), JSON.stringify(versionPointer, null, 2));
        console.log(`✅ 已激活版本: ${version}`);
        console.log(`📝 训练数据已更新: ${targetPath}`);
    }
    /**
     * 获取当前激活的版本
     */
    async getCurrentVersion() {
        try {
            const versionPointerPath = path.join(this.baseDir, 'models', 'production', 'version.json');
            const data = await fs.readFile(versionPointerPath, 'utf-8');
            const pointer = JSON.parse(data);
            return pointer.currentVersion;
        }
        catch {
            return null;
        }
    }
    /**
     * 比较两个版本的差异
     */
    async compareVersions(v1, v2) {
        const details1 = await this.getVersionDetails(v1);
        const details2 = await this.getVersionDetails(v2);
        if (!details1 || !details2) {
            throw new Error('版本不存在');
        }
        const fingerprints1 = new Set(details1.samples.map(s => s.fingerprint));
        const fingerprints2 = new Set(details2.samples.map(s => s.fingerprint));
        const added = details2.samples.filter(s => !fingerprints1.has(s.fingerprint)).length;
        const removed = details1.samples.filter(s => !fingerprints2.has(s.fingerprint)).length;
        const modified = 0; // 简化实现，可以后续添加内容对比
        return {
            added,
            removed,
            modified,
            sampleCountDiff: details2.samples.length - details1.samples.length,
            scoreDiff: details2.metadata.stats.avgScore - details1.metadata.stats.avgScore
        };
    }
    calculateStats(samples) {
        const highQuality = samples.filter(s => s.qualityLevel === 'high').length;
        const mediumQuality = samples.filter(s => s.qualityLevel === 'medium').length;
        const lowQuality = samples.filter(s => s.qualityLevel === 'low').length;
        const avgScore = samples.reduce((sum, s) => sum + s.score, 0) / samples.length;
        return {
            totalSamples: samples.length,
            highQuality,
            mediumQuality,
            lowQuality,
            avgScore
        };
    }
    calculateSourceBreakdown(samples) {
        const breakdown = {};
        for (const sample of samples) {
            breakdown[sample.source] = (breakdown[sample.source] || 0) + 1;
        }
        return breakdown;
    }
    /**
     * 更新版本描述（用户备注）
     */
    async updateVersionDescription(version, newDescription) {
        const details = await this.getVersionDetails(version);
        if (!details) {
            throw new Error(`版本 ${version} 不存在`);
        }
        const versions = await this.listVersions();
        const targetVersion = versions.find(v => v.version === version);
        if (!targetVersion) {
            throw new Error(`版本 ${version} 不存在`);
        }
        // 更新描述
        details.metadata.description = newDescription;
        // 写回文件
        await fs.writeFile(path.join(targetVersion.path, 'metadata.json'), JSON.stringify(details.metadata, null, 2));
        console.log(`✅ 已更新版本 ${version} 的描述`);
    }
    /**
     * 生成AI总结
     */
    async generateAISummary(samples, stats, previousVersion) {
        let summary = `本次训练包含 ${stats.totalSamples} 个样本，`;
        summary += `平均质量评分 ${stats.avgScore.toFixed(1)} 分。\n`;
        summary += `质量分布：高质量 ${stats.highQuality} 个 (${((stats.highQuality / stats.totalSamples) * 100).toFixed(1)}%)，`;
        summary += `中等质量 ${stats.mediumQuality} 个 (${((stats.mediumQuality / stats.totalSamples) * 100).toFixed(1)}%)，`;
        summary += `低质量 ${stats.lowQuality} 个 (${((stats.lowQuality / stats.totalSamples) * 100).toFixed(1)}%)。\n`;
        // 来源分布
        const sourceBreakdown = this.calculateSourceBreakdown(samples);
        const topSources = Object.entries(sourceBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        summary += `主要数据来源：`;
        summary += topSources.map(([source, count]) => `${source} (${count}个, ${((count / stats.totalSamples) * 100).toFixed(1)}%)`).join('、');
        summary += '。\n';
        // 与上一版本的对比
        if (previousVersion) {
            try {
                const prevDetails = await this.getVersionDetails(previousVersion);
                if (prevDetails) {
                    const sampleDiff = stats.totalSamples - prevDetails.metadata.stats.totalSamples;
                    const scoreDiff = stats.avgScore - prevDetails.metadata.stats.avgScore;
                    summary += `\n相比上一版本 ${previousVersion}：`;
                    summary += `样本数量${sampleDiff >= 0 ? '增加' : '减少'} ${Math.abs(sampleDiff)} 个，`;
                    summary += `平均分${scoreDiff >= 0 ? '提升' : '降低'} ${Math.abs(scoreDiff).toFixed(1)} 分。`;
                }
            }
            catch (error) {
                // 忽略对比错误
            }
        }
        return summary;
    }
}
//# sourceMappingURL=snapshot-manager.js.map