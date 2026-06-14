import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { devicesApi } from '@/api/devices';
import { Device, DeviceKind, KIND_META } from '@/types/device';

interface Props {
  device: Device | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DeviceFormDialog({ device, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const isCreate = !device;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('thermal-printer');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(160);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (open) {
      if (device) {
        setName(device.name);
        setKind(device.kind);
        setBaseUrl(device.base_url);
        setToken(''); // token 传空字符串或不传 = 不修改 token
        setWidth(device.width);
        setHeight(device.height);
        setEnabled(device.enabled);
      } else {
        setName('');
        setKind('thermal-printer');
        setBaseUrl('');
        setToken('');
        setWidth(KIND_META['thermal-printer'].defaultWidth);
        setHeight(KIND_META['thermal-printer'].defaultHeight);
        setEnabled(true);
      }
    }
  }, [device, open]);

  const handleKindChange = (newKind: DeviceKind) => {
    setKind(newKind);
    setWidth(KIND_META[newKind].defaultWidth);
    setHeight(KIND_META[newKind].defaultHeight);
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['devices'] });

  const createMut = useMutation({
    mutationFn: () =>
      devicesApi.create({
        id: crypto.randomUUID(),
        name: name.trim(),
        base_url: baseUrl.trim(),
        width,
        height,
        token: token.trim(),
        enabled,
        kind,
        capabilities: KIND_META[kind].capabilities,
      }),
    onSuccess: () => {
      toast.success('设备已创建');
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(`创建失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const patch: Partial<Device> = {
        name: name.trim(),
        base_url: baseUrl.trim(),
        width,
        height,
        enabled,
        kind,
        capabilities: KIND_META[kind].capabilities,
      };
      if (token.trim() !== '') {
        patch.token = token.trim();
      }
      return devicesApi.update(device!.id, patch);
    },
    onSuccess: () => {
      toast.success('设备已更新');
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(`更新失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const deleteMut = useMutation({
    mutationFn: () => devicesApi.remove(device!.id),
    onSuccess: () => {
      toast.success('设备已删除');
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(`删除失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const isPending = createMut.isPending || updateMut.isPending || deleteMut.isPending;
  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && width > 0 && height > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? '新建设备' : '编辑设备'}</DialogTitle>
          <DialogDescription>
            {isCreate ? '添加一台新的标签机或墨水屏设备。' : '修改设备信息和连接参数。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：客厅热敏打印机"
              disabled={isPending}
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">类型</Label>
            <Select value={kind} onValueChange={(v) => handleKindChange(v as DeviceKind)} disabled={isPending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(KIND_META) as [DeviceKind, typeof KIND_META[DeviceKind]][]).map(([k, meta]) => (
                  <SelectItem key={k} value={k}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">HTTP 端点 (base_url)</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={kind === 'thermal-printer' ? "例如：http://localhost:5000" : "例如：http://192.168.1.100"}
              disabled={isPending}
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Token / 鉴权 (可选)</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={isCreate ? "Bearer xxx，无需鉴权可留空" : "留空=不修改"}
              disabled={isPending}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">宽度 (width)</Label>
              <Input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                min={1}
                disabled={isPending}
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">高度 (height)</Label>
              <Input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                min={1}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm">启用</Label>
              <p className="text-xs text-muted-foreground">停用后将无法收到推送或打印任务</p>
            </div>
            <Toggle
              pressed={enabled}
              onPressedChange={setEnabled}
              disabled={isPending}
              variant="outline"
              size="sm"
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {enabled ? '已启用' : '已停用'}
            </Toggle>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {!isCreate && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground mr-auto"
                  disabled={isPending}
                >
                  删除设备
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除设备？</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要删除设备「{device?.name}」吗？此操作无法撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMut.mutate()}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={() => (isCreate ? createMut.mutate() : updateMut.mutate())}
            disabled={isPending || !canSubmit}
          >
            {isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
