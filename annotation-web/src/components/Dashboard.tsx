import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { CheckCircle2, Clock, FileText, TrendingUp } from 'lucide-react';

function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['statistics'],
    queryFn: () => apiClient.getStatistics(),
    refetchInterval: 30000, // 每30秒自动刷新一次
    staleTime: 0, // 数据立即过期，确保每次都是最新的
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const progress = stats?.data?.progress;
  const qualityDist = stats?.data?.qualityDistribution || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">标注进度概览</h2>
        <p className="text-gray-600 mt-1">查看整体标注进度和质量分布</p>
      </div>

      {/* 进度卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={FileText}
          label="总新闻数"
          value={progress?.total_count || 0}
          color="blue"
        />
        <StatCard
          icon={Clock}
          label="待标注"
          value={progress?.pending_count || 0}
          color="yellow"
        />
        <StatCard
          icon={CheckCircle2}
          label="已完成"
          value={progress?.completed_count || 0}
          color="green"
        />
        <StatCard
          icon={TrendingUp}
          label="完成率"
          value={`${progress?.completion_rate || 0}%`}
          color="purple"
        />
      </div>

      {/* 质量分布 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">质量分布</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {qualityDist.map((dist) => (
            <div
              key={dist.quality_level}
              className="border border-gray-200 rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">
                  {dist.quality_level === 'high' && '高质量'}
                  {dist.quality_level === 'medium' && '中等质量'}
                  {dist.quality_level === 'low' && '低质量'}
                </span>
                <span className="text-2xl font-bold text-gray-900">
                  {dist.count}
                </span>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <div>平均分: {dist.avg_score != null ? Number(dist.avg_score).toFixed(1) : 'N/A'}</div>
                <div>
                  范围: {dist.min_score} - {dist.max_score}
                </div>
              </div>
              <div className="mt-3">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      dist.quality_level === 'high'
                        ? 'bg-green-500'
                        : dist.quality_level === 'medium'
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    }`}
                    style={{
                      width: `${
                        ((dist.count / (progress?.completed_count || 1)) * 100) ||
                        0
                      }%`,
                    }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 快速操作 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">快速操作</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/annotate"
            className="flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            开始标注
          </a>
          <a
            href="/import"
            className="flex items-center justify-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            导入新数据
          </a>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: 'blue' | 'yellow' | 'green' | 'purple';
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`p-3 rounded-full ${colorClasses[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
