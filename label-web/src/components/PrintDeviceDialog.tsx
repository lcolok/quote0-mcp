import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { devicesApi } from '@/api/devices';
import { KIND_META, deviceKindsForTarget } from '@/types/device';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetId: string;                       // 当前标签/批次的尺寸 target，用于过滤匹配设备
  pending: boolean;
  onConfirm: (deviceId: string) => void;
  title?: string;
  description?: string;
}

export default function PrintDeviceDialog({
  open, onOpenChange, targetId, pending, onConfirm, title, description,
}: Props) {
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: () => devicesApi.list() });
  const acceptKinds = deviceKindsForTarget(targetId);
  const matched = (devices ?? []).filter((d) => d.enabled && acceptKinds.includes(d.kind));
  const [deviceId, setDeviceId] = useState('');

  // 打开时默认选中第一台匹配设备
  useEffect(() => {
    if (open && matched.length && !matched.some((d) => d.id === deviceId)) {
      setDeviceId(matched[0].id);
    }
  }, [open, matched, deviceId]);

  const selectedKind = matched.find((d) => d.id === deviceId)?.kind;
  const actionLabel = selectedKind ? KIND_META[selectedKind].action : '输出';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? '选择设备'}</DialogTitle>
          <DialogDescription>
            {description ?? '选择一台匹配当前标签尺寸的设备进行输出。'}
          </DialogDescription>
        </DialogHeader>

        {matched.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            没有匹配当前标签类型的可用设备。
            <Link to="/devices" className="text-primary underline ml-1" onClick={() => onOpenChange(false)}>
              去设备页添加
            </Link>
          </div>
        ) : (
          <Select value={deviceId} onValueChange={setDeviceId} disabled={pending}>
            <SelectTrigger>
              <SelectValue placeholder="选择设备" />
            </SelectTrigger>
            <SelectContent>
              {matched.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} · {KIND_META[d.kind].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(deviceId)}
            disabled={pending || !deviceId || matched.length === 0}
          >
            {pending ? '处理中…' : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
