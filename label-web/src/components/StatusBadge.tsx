import type { Label } from '@/types/label';

const statusMap: Record<Label['status'], { text: string; className: string }> = {
  draft: { text: '草稿', className: 'bg-gray-100 text-gray-700' },
  approved: { text: '已批准', className: 'bg-blue-100 text-blue-700' },
  printed: { text: '已打印', className: 'bg-green-100 text-green-700' },
  archived: { text: '已归档', className: 'bg-yellow-100 text-yellow-700' },
  generating: { text: '生成中', className: 'bg-purple-100 text-purple-700 animate-pulse' },
  failed: { text: '失败', className: 'bg-red-100 text-red-700' },
};

interface StatusBadgeProps {
  status: Label['status'];
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { text, className } = statusMap[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {text}
    </span>
  );
}
