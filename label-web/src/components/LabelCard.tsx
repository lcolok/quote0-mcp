import { Link, useLocation } from 'react-router-dom';
import { ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatusBadge from './StatusBadge';
import type { Label } from '@/types/label';

interface LabelCardProps {
  label: Label;
}

export default function LabelCard({ label }: LabelCardProps) {
  const location = useLocation();
  const isDesign = location.pathname === '/';
  const fromQuery = new URLSearchParams();
  if (isDesign) {
    fromQuery.set('from', 'design');
    const currentTab = new URLSearchParams(location.search).get('tab');
    if (currentTab) fromQuery.set('tab', currentTab);
  } else {
    fromQuery.set('from', 'history');
  }
  const toUrl = `/labels/${label.id}?${fromQuery.toString()}`;

  const shortPrompt = label.prompt.length > 12 ? label.prompt.slice(0, 12) + '…' : label.prompt;
  const dateStr = new Date(label.createdAt).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Link to={toUrl} className="group block">
      <Card className="p-3 hover:shadow-md transition-all-smooth">
        <div className="aspect-[2/1] overflow-hidden rounded-md bg-muted mb-2 flex items-center justify-center">
          {label.status === 'generating' ? (
            <div className="flex flex-col items-center gap-1 text-purple-600 dark:text-purple-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">生成中…</span>
            </div>
          ) : label.status === 'failed' ? (
            <div className="flex flex-col items-center gap-1 text-destructive px-2 text-center">
              <AlertCircle className="h-6 w-6" />
              <span className="text-xs truncate max-w-full" title={label.lastError ?? ''}>
                {label.lastError ? label.lastError.slice(0, 30) + (label.lastError.length > 30 ? '…' : '') : '失败'}
              </span>
            </div>
          ) : label.pngUrl ? (
            <img
              src={label.pngUrl}
              alt={label.prompt}
              className="h-full w-full object-contain group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="text-xs text-muted-foreground">无预览</div>
          )}
        </div>
        <p className="text-sm font-medium text-foreground truncate">{shortPrompt}</p>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={label.status} />
            {label.sourceType === 'image' && (
              <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-600 dark:text-purple-400 gap-0.5" title={`AI: ${label.sourceModel ?? ''}`}>
                <ImageIcon className="h-3 w-3" />
                {label.sourceModel ?? 'AI'}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{dateStr}</span>
        </div>
      </Card>
    </Link>
  );
}
