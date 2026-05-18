import { Badge } from '@/components/ui/badge';
import type { Label } from '@/types/label';

const statusConfig: Record<Label['status'], { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  draft:      { text: '草稿',     variant: 'secondary' },
  approved:   { text: '已批准',   variant: 'default' },
  printed:    { text: '已打印',   variant: 'outline', className: 'border-green-500/50 text-green-700 dark:text-green-400' },
  archived:   { text: '已归档',   variant: 'outline', className: 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400' },
  generating: { text: '生成中',   variant: 'outline', className: 'border-purple-500/50 text-purple-700 dark:text-purple-400 animate-pulse' },
  failed:     { text: '失败',     variant: 'destructive' },
};

interface StatusBadgeProps {
  status: Label['status'];
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { text, variant, className } = statusConfig[status];
  return <Badge variant={variant} className={className}>{text}</Badge>;
}
