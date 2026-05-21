import { Cloud, Wifi, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MemoTargetRenderer } from '@/types/memo';

interface Props {
  value: MemoTargetRenderer;
  onChange: (v: MemoTargetRenderer) => void;
  disabled?: boolean;
  className?: string;
}

const OPTIONS: { value: MemoTargetRenderer; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    value: 'device',
    label: 'MindReset 云端墨水屏',
    icon: <Cloud className="h-6 w-6" />,
    desc: '商用设备，走云端 API',
  },
  {
    value: 'local-eink',
    label: 'ESP32-C3 本地屏',
    icon: <Wifi className="h-6 w-6" />,
    desc: '用户自制，局域网',
  },
  {
    value: 'both',
    label: '两块都推',
    icon: <ArrowLeftRight className="h-6 w-6" />,
    desc: '云端 + 本地同时推送',
  },
];

export default function MemoTargetSelector({ value, onChange, disabled, className }: Props) {
  return (
    <div className={cn('space-y-2', className)}>
      <label className="block text-sm font-medium text-foreground">推送目标</label>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 p-3 text-center transition cursor-pointer',
              value === opt.value
                ? 'border-primary ring-2 ring-primary/50 shadow-md bg-primary/5'
                : 'border-border hover:border-primary/50 hover:shadow bg-card',
              disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
            )}
          >
            <div
              className={cn(
                'transition-colors',
                value === opt.value ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {opt.icon}
            </div>
            <div className="text-xs font-medium text-foreground leading-tight">{opt.label}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</div>

            {value === opt.value && (
              <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
