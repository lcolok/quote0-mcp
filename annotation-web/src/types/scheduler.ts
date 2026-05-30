// 前端视图层精简 scheduler job 接口
// 仅包含 JobsManagementPage 实际消费的字段子集
// 后端权威类型在 src/api/news-types.ts:NewsSchedulerJobRecord，本接口故意不耦合
export interface SchedulerJob {
  id: string;
  name?: string;
  description?: string;
  category: string;
  dataSource: string;
  rssSource?: string;
  rssSources?: string[];
  processor: string;
  renderer: string;
  intervalMs: number;
  enabled: boolean;
  jobRole?: 'producer' | 'consumer' | 'mixed';
  indexStrategy?: Record<string, any>;
  lastRunAt?: string;
}
