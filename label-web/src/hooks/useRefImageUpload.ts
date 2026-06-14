import { useRef, useState, type DragEvent, type DragEventHandler } from 'react';
import { toast } from 'sonner';
import { labelsApi } from '@/api/labels';

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

export interface UseRefImageUpload {
  isUploading: boolean;
  canAddMore: boolean;
  accept: string;
  inputRef: React.RefObject<HTMLInputElement>;
  openPicker: () => void;
  processFiles: (files: File[]) => Promise<void>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  remove: (idx: number) => void;
  /** 拖拽上传：把整组事件 spread 到任意容器，配合 isDragging 做高亮 */
  isDragging: boolean;
  dragProps: {
    onDragEnter: DragEventHandler;
    onDragOver: DragEventHandler;
    onDragLeave: DragEventHandler;
    onDrop: DragEventHandler;
  };
}

export function useRefImageUpload(opts: {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxImages: number;
  disabled?: boolean;
}): UseRefImageUpload {
  const { urls, onChange, maxImages, disabled } = opts;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const processFiles = async (files: File[]) => {
    if (disabled) return;
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

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    await processFiles(files);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length === 0) return;

    e.preventDefault();
    await processFiles(files);
  };

  const remove = (idx: number) => {
    if (disabled) return;
    onChange(urls.filter((_, i) => i !== idx));
  };

  const openPicker = () => {
    inputRef.current?.click();
  };

  const canAddMore = urls.length < maxImages && !disabled;

  const [isDragging, setIsDragging] = useState(false);

  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled || !canAddMore) return;
      // 仅在真的拖文件进来时高亮（拖文本/元素不触发）
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) setIsDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDragLeave: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // 只在离开整个容器时关闭高亮（避免子元素 dragleave 闪烁）
      if (e.currentTarget === e.target) setIsDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void processFiles(files);
    },
  };

  return {
    isUploading,
    canAddMore,
    accept: ACCEPT,
    inputRef,
    openPicker,
    processFiles,
    handleInputChange,
    handlePaste,
    remove,
    isDragging,
    dragProps,
  };
}
