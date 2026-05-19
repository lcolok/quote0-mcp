import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, X, Loader2 } from 'lucide-react';
import { labelsApi } from '@/api/labels';
import { cn } from '@/lib/utils';

interface Props {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxImages?: number;
  disabled?: boolean;
  className?: string;
}

const ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export default function RefImageUploader({
  urls,
  onChange,
  maxImages = 8,
  disabled,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    const room = maxImages - urls.length;
    if (fileList.length > room) {
      toast.warning(`最多 ${maxImages} 张，仅上传前 ${room} 张`);
    }
    const filesToUpload = fileList.slice(0, room);

    // size 预检
    const validFiles = filesToUpload.filter((f) => {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} 超过 10MB，跳过`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    let accumulated = [...urls];
    for (const f of validFiles) {
      try {
        const res = await labelsApi.uploadRefImage(f);
        accumulated = [...accumulated, res.url];
        onChange(accumulated);
      } catch (e: any) {
        toast.error(`${f.name} 上传失败：${e?.response?.data?.error ?? e?.message}`);
      }
    }
    setIsUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRemove = (idx: number) => {
    if (disabled) return;
    onChange(urls.filter((_, i) => i !== idx));
  };

  const canAddMore = urls.length < maxImages && !disabled;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-foreground">
          参考图（可选）
        </label>
        <span className="text-xs text-muted-foreground">
          {urls.length}/{maxImages} · 用于风格学习，不复制内容
        </span>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
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
              onClick={() => handleRemove(idx)}
              disabled={disabled}
              className="absolute top-1 right-1 p-1 rounded bg-background/80 hover:bg-destructive hover:text-destructive-foreground opacity-0 group-hover:opacity-100 transition"
              title="移除"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {canAddMore && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className={cn(
              'aspect-square rounded-lg border-2 border-dashed border-border',
              'flex flex-col items-center justify-center gap-1 text-muted-foreground',
              'hover:border-primary hover:text-primary transition',
              isUploading && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span className="text-[10px]">添加</span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        type="file"
        ref={inputRef}
        onChange={handleFileChange}
        accept={ACCEPT}
        multiple
        className="hidden"
      />
    </div>
  );
}
