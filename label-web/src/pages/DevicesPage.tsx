import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, HardDrive, Printer, MonitorSmartphone, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { devicesApi } from '@/api/devices';
import DeviceFormDialog from '@/components/DeviceFormDialog';
import { Device, DeviceKind, KIND_META } from '@/types/device';

function getKindIcon(kind: DeviceKind) {
  switch (kind) {
    case 'thermal-printer': return <Printer className="h-4 w-4" />;
    case 'eink-local': return <MonitorSmartphone className="h-4 w-4" />;
    case 'eink-cloud': return <Cloud className="h-4 w-4" />;
  }
}

export default function DevicesPage() {
  const navigate = useNavigate();
  const [dialogDevice, setDialogDevice] = useState<Device | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: devices, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list(),
  });

  const openCreate = () => {
    setDialogDevice(null);
    setDialogOpen(true);
  };

  const openEdit = (device: Device) => {
    setDialogDevice(device);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            设计
          </Button>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            设备 Devices
          </h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新建设备
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        </div>
      ) : devices && devices.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {devices.map((device) => (
            <Card
              key={device.id}
              className="p-4 cursor-pointer hover:border-primary/50 transition-colors flex flex-col gap-2"
              onClick={() => openEdit(device)}
            >
              <div className="flex items-start justify-between">
                <div className="font-medium text-foreground truncate">{device.name}</div>
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    device.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'
                  }`}
                  title={device.enabled ? '已启用' : '已停用'}
                />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="flex items-center gap-1 font-normal">
                  {getKindIcon(device.kind)}
                  {KIND_META[device.kind].label}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-1" title={device.base_url}>
                {device.base_url}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 flex flex-col items-center justify-center text-center gap-4">
          <HardDrive className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">暂无设备</p>
            <p className="text-xs text-muted-foreground mt-1">
              点击右上角「新建设备」添加第一台设备。
            </p>
          </div>
          <Button variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            新建设备
          </Button>
        </Card>
      )}

      <DeviceFormDialog
        device={dialogDevice}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
