import { Link } from 'react-router-dom';
import { ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import type { Label } from '@/types/label';
import StatusBadge from './StatusBadge';

interface LabelCardProps {
  label: Label;
}

export default function LabelCard({ label }: LabelCardProps) {
  const shortPrompt = label.prompt.length > 12 ? label.prompt.slice(0, 12) + '…' : label.prompt;
  const dateStr = new Date(label.createdAt).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Link to={`/labels/${label.id}`} className="group block rounded-lg border border-gray-200 bg-white p-3 hover:shadow-md transition-all-smooth">
      <div className="aspect-[2/1] overflow-hidden rounded-md bg-gray-50 mb-2 flex items-center justify-center">
        {label.status === 'generating' ? (
          <div className="flex flex-col items-center gap-1 text-purple-600">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs">生成中…</span>
          </div>
        ) : label.status === 'failed' ? (
          <div className="flex flex-col items-center gap-1 text-red-600 px-2 text-center">
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
          <div className="text-xs text-gray-400">无预览</div>
        )}
      </div>
      <p className="text-sm font-medium text-gray-800 truncate">{shortPrompt}</p>
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={label.status} />
          {label.sourceType === 'image' && (
            <span className="inline-flex items-center gap-0.5 text-xs text-purple-600" title={`AI: ${label.sourceModel ?? ''}`}>
              <ImageIcon className="h-3 w-3" />
              {label.sourceModel ?? 'AI'}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{dateStr}</span>
      </div>
    </Link>
  );
}
