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
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 后端硬限制 10MB
const MAX_DIMENSION = 1280;              // resize 最长边（标签场景 320×160，1280 已是 4x 超采样）
const JPEG_QUALITY = 0.85;
const RESIZE_THRESHOLD_BYTES = 1 * 1024 * 1024; // > 1MB 才 resize，小图不动

/** 客户端 Canvas resize：把大图压成 maxDim ≤ MAX_DIMENSION 的 JPEG/PNG。
 *  - <RESIZE_THRESHOLD_BYTES 不动（保留原图质量）
 *  - 原 type 是 PNG 且无透明保留则转 JPEG（更小）；含透明则保留 PNG
 *  - 失败抛错，调用方 catch */
async function resizeImage(file: File): Promise<File> {
  // 小图直接返回
  if (file.size <= RESIZE_THRESHOLD_BYTES) return file;

  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    img.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败'));
    });

    // 已经够小，无需 resize
    if (img.width <= MAX_DIMENSION && img.height <= MAX_DIMENSION) {
      return file;
    }

    // 等比缩放
    let w = img.width;
    let h = img.height;
    if (w > h) {
      h = Math.round((h * MAX_DIMENSION) / w);
      w = MAX_DIMENSION;
    } else {
      w = Math.round((w * MAX_DIMENSION) / h);
      h = MAX_DIMENSION;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context 不可用');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    // PNG 保留（可能含透明），其他统一 JPEG（体积更小）
    const targetType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob 失败'))),
        targetType,
        JPEG_QUALITY,
      );
    });

    const ext = targetType === 'image/png' ? 'png' : 'jpg';
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.${ext}`, { type: targetType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function RefImageUploader({
  urls,
  onChange,
  maxImages = 8,
  disabled,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = async (files: File[]) => {
    const room = maxImages - urls.length;
    if (files.length > room) {
      toast.warning(`最多 ${maxImages} 张，仅处理前 ${room} 张`);
    }
    const toProcess = files.slice(0, room).filter((f) => f.type.startsWith('image/'));
    if (toProcess.length === 0) {
      toast.error('请选择图片文件');
      return;
    }

    setIsUploading(true);
    let accumulated = [...urls];
    for (const f of toProcess) {
      try {
        // 尝试 resize（大图自动压缩到 1280px 内）
        let toUpload: File = f;
        try {
          toUpload = await resizeImage(f);
          if (toUpload !== f) {
            console.log(
              `[ref-upload] resized ${f.name}: ${(f.size / 1024).toFixed(0)}KB → ${(toUpload.size / 1024).toFixed(0)}KB`,
            );
          }
        } catch (resizeErr: any) {
          console.warn(`[ref-upload] resize 失败，尝试原图上传:`, resizeErr?.message);
          // resize 失败 fallthrough 到原文件，让后端 size 限制兜底
        }

        // 后端 10MB 硬限制兜底
        if (toUpload.size > MAX_FILE_BYTES) {
          toast.error(`${f.name} 压缩后仍 > 10MB，跳过`);
          continue;
        }

        const res = await labelsApi.uploadRefImage(toUpload);
        accumulated = [...accumulated, res.url];
        onChange(accumulated);
      } catch (e: any) {
        toast.error(`${f.name} 上传失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`);
      }
    }
    setIsUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    await processFiles(files);
  };

  const handleRemove = (idx: number) => {
    if (disabled) return;
    onChange(urls.filter((_, i) => i !== idx));
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || urls.length >= maxImages || isUploading) return;
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
    if (disabled || isUploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    await processFiles(files);
  };

  const canAddMore = urls.length < maxImages && !disabled;

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
          {urls.length}/{maxImages} · 用于风格学习，不复制内容 · 大图自动压缩
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
              'aspect-square rounded-lg border-2 border-dashed',
              'flex flex-col items-center justify-center gap-1 text-muted-foreground',
              'transition',
              isDragging
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border hover:border-primary hover:text-primary',
              isUploading && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isUploading ? (
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
        ref={inputRef}
        onChange={handleFileChange}
        accept={ACCEPT}
        multiple
        className="hidden"
      />
    </div>
  );
}
