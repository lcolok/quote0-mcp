import { useState } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRefImageUpload } from '@/hooks/useRefImageUpload';

interface Props {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxImages?: number;
  disabled?: boolean;
  className?: string;
}

export default function RefImageUploader({
  urls,
  onChange,
  maxImages = 8,
  disabled,
  className,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const up = useRefImageUpload({ urls, onChange, maxImages, disabled });

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || urls.length >= maxImages || up.isUploading) return;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只在离开整个容器时关闭 highlight（避免子元素 dragleave 闪烁）
    if (e.currentTarget === e.target) setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled || up.isUploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    await up.processFiles(files);
  };

  return (
    <div
      className={cn('space-y-2', className)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-foreground">参考图（可选）</label>
        <span className="text-xs text-muted-foreground">
          {urls.length}/{maxImages} · AI 视觉输入 · 编辑/扩展/风格皆可 · 大图自动压缩
        </span>
      </div>

      <div
        className={cn(
          'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 rounded-lg transition',
          isDragging && 'ring-2 ring-primary bg-primary/5 p-1',
        )}
      >
        {urls.map((url, idx) => (
          <div
            key={idx}
            className="relative aspect-square rounded-lg border-2 border-border overflow-hidden group bg-muted"
          >
            <img
              src={url}
              alt={`ref-${idx + 1}`}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <button
              type="button"
              onClick={() => up.remove(idx)}
              disabled={disabled}
              className="absolute top-1 right-1 p-1 rounded bg-background/80 hover:bg-destructive hover:text-destructive-foreground opacity-0 group-hover:opacity-100 transition"
              title="移除"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {up.canAddMore && (
          <button
            type="button"
            onClick={up.openPicker}
            disabled={up.isUploading}
            className={cn(
              'aspect-square rounded-lg border-2 border-dashed',
              'flex flex-col items-center justify-center gap-1 text-muted-foreground',
              'transition',
              isDragging
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border hover:border-primary hover:text-primary',
              up.isUploading && 'opacity-50 cursor-not-allowed',
            )}
          >
            {up.isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span className="text-[10px]">
                  {isDragging ? '松开上传' : '添加'}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        type="file"
        ref={up.inputRef}
        onChange={up.handleInputChange}
        accept={up.accept}
        multiple
        className="hidden"
      />
    </div>
  );
}
