import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Info } from 'lucide-react';
import { labelsApi } from '@/api/labels';
import PresetDetailDialog from './PresetDetailDialog';
import type { ImagePreset } from '@/types/label';
import { cn } from '@/lib/utils';

interface Props {
  /** 当前选中：'none' / preset id / null（视为 'none'） */
  selectedPresetId: string | null;
  /** 选中变化回调；'none' 表示选无预设 */
  onSelect: (presetId: string) => void;
  disabled?: boolean;
  className?: string;
}

export const NONE_PRESET_ID = 'none' as const;

export default function StylePresetGrid({ selectedPresetId, onSelect, disabled, className }: Props) {
  const { data: presets = [], isLoading } = useQuery({
    queryKey: ['image-presets'],
    queryFn: () => labelsApi.listPresets(),
    staleTime: 30_000,
  });

  const [detailPreset, setDetailPreset] = useState<ImagePreset | null>(null);

  const effectiveSelected = selectedPresetId ?? NONE_PRESET_ID;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-foreground">风格预设</label>
        <span className="text-xs text-muted-foreground">
          {effectiveSelected === NONE_PRESET_ID ? '无预设 · 纯文生图' : '已应用 oneshot 风格学习'}
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {/* 「无」卡片（始终第一） */}
        <PresetCard
          name="无"
          icon={<Ban className="h-6 w-6 text-muted-foreground" />}
          isSelected={effectiveSelected === NONE_PRESET_ID}
          onClick={() => !disabled && onSelect(NONE_PRESET_ID)}
          disabled={disabled}
        />

        {isLoading && (
          <div className="aspect-square rounded-lg border-2 border-dashed border-border bg-muted/50 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">加载中…</span>
          </div>
        )}

        {presets.map((p) => (
          <PresetCard
            key={p.id}
            name={p.name}
            thumbnailUrl={p.thumbnailUrl}
            isSystem={p.isSystem}
            isSelected={effectiveSelected === p.id}
            onClick={() => !disabled && onSelect(p.id)}
            onInfo={() => setDetailPreset(p)}
            disabled={disabled}
          />
        ))}
      </div>

      <PresetDetailDialog
        preset={detailPreset}
        open={!!detailPreset}
        onOpenChange={(o) => { if (!o) setDetailPreset(null); }}
      />
    </div>
  );
}

interface CardProps {
  name: string;
  thumbnailUrl?: string | null;
  icon?: React.ReactNode;
  isSystem?: boolean;
  isSelected: boolean;
  onClick: () => void;
  onInfo?: () => void;
  disabled?: boolean;
}

function PresetCard({
  name,
  thumbnailUrl,
  icon,
  isSystem,
  isSelected,
  onClick,
  onInfo,
  disabled,
}: CardProps) {
  return (
    <div
      className={cn(
        'group relative aspect-square rounded-lg border-2 overflow-hidden transition cursor-pointer',
        isSelected
          ? 'border-primary ring-2 ring-primary/50 shadow-md'
          : 'border-border hover:border-primary/50 hover:shadow',
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        thumbnailUrl ? 'bg-muted' : 'bg-card',
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* 缩略图或图标 */}
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={name}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">{icon}</div>
      )}

      {/* 底部名称（黑色渐变背景，确保白字在缩略图上可读） */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-1.5 pt-3 pb-1">
        <div className="text-white text-xs font-medium truncate" title={name}>
          {name}
        </div>
      </div>

      {/* 系统 preset 角标 */}
      {isSystem && (
        <span className="absolute top-1 left-1 bg-primary/90 text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded">
          内置
        </span>
      )}

      {/* 选中态打勾 */}
      {isSelected && (
        <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
          ✓
        </span>
      )}

      {/* 详情/管理按钮（hover 显示，所有真实预设都有） */}
      {onInfo && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onInfo(); }}
          className="absolute top-1 right-1 p-1 rounded bg-background/80 opacity-0 group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground transition"
          title="查看 / 管理预设"
        >
          <Info className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
