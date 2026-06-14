export type DeviceKind = 'thermal-printer' | 'eink-local' | 'eink-cloud';

export interface Device {
  id: string;
  name: string;
  base_url: string;
  token: string;
  width: number;
  height: number;
  enabled: boolean;
  kind: DeviceKind;
  capabilities: string[];
  created_at?: string;
  updated_at?: string;
}

export interface CreateDeviceRequest {
  id: string;
  name: string;
  base_url: string;
  width: number;
  height: number;
  token?: string;
  enabled?: boolean;
  kind?: DeviceKind;
  capabilities?: string[];
}

export const KIND_META: Record<DeviceKind, { label: string; action: string; capabilities: string[]; defaultWidth: number; defaultHeight: number }> = {
  'thermal-printer': {
    label: '热敏打印机',
    action: '打印',
    capabilities: ['print'],
    defaultWidth: 320,
    defaultHeight: 160,
  },
  'eink-local': {
    label: '本地墨水屏',
    action: '推送',
    capabilities: ['display'],
    defaultWidth: 296,
    defaultHeight: 152,
  },
  'eink-cloud': {
    label: '云端墨水屏',
    action: '推送',
    capabilities: ['display'],
    defaultWidth: 296,
    defaultHeight: 152,
  },
};

// targetId → 可用设备 kind 列表(镜像后端 render-targets.ts 的 kind 语义):
// eink-* 屏 → eink 设备; 其余(label-*/thermal 标签) → 热敏打印机
export function deviceKindsForTarget(targetId: string): DeviceKind[] {
  if (targetId.startsWith('eink')) return ['eink-local', 'eink-cloud'];
  return ['thermal-printer'];
}
