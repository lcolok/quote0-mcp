import { useState } from 'react';
import { Loader2, AlertCircle, FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Memo, MemoStatus, MemoTargetRenderer } from '@/types/memo';

interface Props {
  memo: Memo;
  onClick?: () => void;
}

const statusConfig: Record<MemoStatus, { text: string; className: string }> = {
  draft: { text: '草稿', className: 'bg-secondary text-secondary-foreground' },
  rendering: { text: '渲染中', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 animate-pulse' },
  ready: { text: '就绪', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  failed: { text: '失败', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
};

const targetRendererConfig: Record<MemoTargetRenderer, { text: string; className: string }> = {
  device: { text: '云端', className: 'border-blue-500/50 text-blue-600 dark:text-blue-400' },
  'local-eink': { text: '本地', className: 'border-amber-500/50 text-amber-600 dark:text-amber-400' },
  both: { text: '双推', className: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400' },
};

export default function MemoCard({ memo, onClick }: Props) {
  const [imgError, setImgError] = useState(false);
  const shortText = memo.text.length > 14 ? memo.text.slice(0, 14) + '…' : memo.text;
  const dateStr = new Date(memo.createdAt).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const statusStyle = statusConfig[memo.status];
  const targetStyle = targetRendererConfig[memo.targetRenderer];

  return (
    <Card
      className={cn(
        'p-3 hover:shadow-md transition-all cursor-pointer',
        !memo.enabled && 'opacity-60'
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="aspect-[2/1] overflow-hidden rounded-md bg-muted mb-2 flex items-center justify-center">
        {memo.status === 'rendering' ? (
          <div className="flex flex-col items-center gap-1 text-purple-600 dark:text-purple-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs">渲染中…</span>
          </div>
        ) : memo.status === 'failed' ? (
          <div className="flex flex-col items-center gap-1 text-destructive px-2 text-center">
            <AlertCircle className="h-6 w-6" />
            <span className="text-xs truncate max-w-full" title={memo.lastError ?? ''}>
              {memo.lastError ? memo.lastError.slice(0, 30) + (memo.lastError.length > 30 ? '…' : '') : '失败'}
            </span>
          </div>
        ) : memo.pngUrl && !imgError ? (
          <img
            src={`${memo.pngUrl}?v=${encodeURIComponent(memo.updatedAt)}`}
            alt={memo.text}
            className="h-full w-full object-contain hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <FileText className="h-6 w-6" />
            <span className="text-xs">无预览</span>
          </div>
        )}
      </div>

      <p className="text-sm font-medium text-foreground truncate" title={memo.text}>
        {shortText}
      </p>

      <div className="mt-1.5 flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={cn('text-[10px] px-1 py-0', statusStyle.className)}>
            {statusStyle.text}
          </Badge>
          <Badge variant="outline" className={cn('text-[10px] px-1 py-0', targetStyle.className)}>
            {targetStyle.text}
          </Badge>
          {!memo.enabled && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 border-gray-400/50 text-gray-500">
              已停用
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{dateStr}</span>
      </div>
    </Card>
  );
}
