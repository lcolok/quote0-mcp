import { CheckCircle2, FileJson2, FlaskConical, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

const stages = [
  {
    icon: FileJson2,
    title: '1. 固定提示配置',
    text: '生产处理器加载版本化 prompt profile；旧 ax-optimized 仅作为任务配置兼容别名。',
  },
  {
    icon: FlaskConical,
    title: '2. 运行留出集评估',
    text: '在从未进入 few-shot 示例的人工样本上，对比基线与候选配置。',
  },
  {
    icon: CheckCircle2,
    title: '3. 达标后再激活',
    text: '只有事实一致性、长度合规和人工偏好均通过门禁，候选版本才可进入发布链。',
  },
];

export default function EvaluationPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">评估与提示配置</h2>
        <p className="text-gray-600 mt-1">这里不再把 few-shot 示例选择称为模型训练。</p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 flex gap-3">
        <ShieldAlert className="w-6 h-6 text-amber-700 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-amber-900">自动“训练/部署”已停用</h3>
          <p className="text-sm text-amber-800 mt-1">
            旧流程使用随机准确率和静态示例，不能证明内容质量提升。当前只允许导出评审样本；真正的候选配置需要独立留出集结果。
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {stages.map(({ icon: Icon, title, text }) => (
          <div key={title} className="bg-white rounded-lg border border-gray-200 p-5">
            <Icon className="w-6 h-6 text-primary-600" />
            <h3 className="font-semibold text-gray-900 mt-3">{title}</h3>
            <p className="text-sm text-gray-600 mt-2">{text}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900">当前门禁</h3>
        <ul className="mt-3 space-y-2 text-sm text-gray-700 list-disc pl-5">
          <li>不展示未经计算的准确率、质量分或提升百分比。</li>
          <li>评审决策绑定内容 fingerprint，不绑定某一次投递。</li>
          <li>生成链的长度合规只作为机械指标，不等同于语义质量。</li>
        </ul>
        <Link to="/export" className="inline-flex mt-5 text-sm font-medium text-primary-700 hover:text-primary-800">
          前往导出评审样本 →
        </Link>
      </div>
    </div>
  );
}
