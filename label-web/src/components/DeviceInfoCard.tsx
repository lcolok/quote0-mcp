import { useQuery } from '@tanstack/react-query';
import { Battery, BatteryWarning, Printer, Ruler, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { labelsApi } from '@/api/labels';
import type { CurrentTargetInfo } from '@/types/label';

/**
 * 设备信息卡片
 * 展示当前连接的热敏打印机型号、DPI、电量、RFID 纸张规格与打印像素尺寸。
 */
export default function DeviceInfoCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['current-target'],
    queryFn: () => labelsApi.getCurrentTarget(),
    staleTime: 10_000,
    retry: 1,
  });

  // 统一读取 target（优先实际 target，其次 fallback）
  const target: CurrentTargetInfo | undefined = data?.target ?? data?.fallback;
  const isOffline = isError || (!isLoading && (!data?.success || !target));

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Printer className="h-4 w-4 text-primary" />
            打印设备
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isOffline || !target) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Printer className="h-4 w-4 text-primary" />
            打印设备
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BatteryWarning className="h-4 w-4" />
            <span>设备未连接，使用本地规格兜底</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 至此 target 已确定存在
  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Printer className="h-4 w-4 text-primary" />
          打印设备
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Printer className="h-3 w-3" />
              机型
            </span>
            <div className="font-medium text-foreground">
              {target.modelName || target.device?.model || '未知设备'}
            </div>
            {target.device?.swVersion && (
              <div className="text-[11px] text-muted-foreground">
                固件 {target.device.swVersion}
              </div>
            )}
          </div>

          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">DPI</span>
            <div className="font-medium text-foreground">{target.dpi ?? '-'}</div>
          </div>

          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Battery className="h-3 w-3" />
              电量
            </span>
            <div className="font-medium text-foreground">
              {typeof target.device?.battery === 'number'
                ? `${target.device.battery}/4`
                : '-'}
            </div>
          </div>

          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Ruler className="h-3 w-3" />
              RFID 纸张
            </span>
            <div className="font-medium text-foreground">
              {target.widthMm}×{target.heightMm} mm
            </div>
            {target.sku && (
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {target.sku}
              </div>
            )}
            {typeof target.remainingMm === 'number' && (
              <div className="text-[11px] text-muted-foreground">
                剩余 {target.remainingMm} mm
              </div>
            )}
          </div>

          <div className="col-span-2 space-y-0.5">
            <span className="text-xs text-muted-foreground">打印图片尺寸</span>
            <div className="font-medium text-foreground">
              {target.widthPx}×{target.heightPx} px
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
