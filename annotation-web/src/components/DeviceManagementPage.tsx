import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MonitorSmartphone,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Wifi,
  WifiOff,
  Send,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { devicesApi, type Device } from '../api/devices';

export default function DeviceManagementPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);

  const { data: devicesData, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.getDevices(),
    refetchInterval: 10000,
  });

  const devices: Device[] = devicesData?.data || [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => devicesApi.deleteDevice(id),
    onSuccess: () => {
      toast.success('设备已删除');
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err: Error) => toast.error(`删除失败: ${err.message}`),
  });

  return (
    <div className="h-[calc(100vh-4rem)] overflow-y-auto p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">推送设备</h3>
            <p className="mt-1 text-xs text-gray-500">登记完成后，点击设备卡片右侧的“去推送”即可选择新闻并发送。</p>
          </div>
          <button
            onClick={() => {
              setEditingDevice(null);
              setModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            新建设备
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : devices.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            <MonitorSmartphone className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>暂无设备</p>
          </div>
        ) : (
          devices.map((device) => (
            <div key={device.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MonitorSmartphone className="w-5 h-5 text-gray-500" />
                  <div>
                    <div className="font-medium text-gray-900">
                      {device.name}
                      <span className="ml-2 text-xs text-gray-400">({device.id})</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {device.base_url}
                      <span className="ml-2 text-gray-400">
                        {device.kind === 'eink-local' ? '本地墨水屏' : device.kind === 'eink-cloud' ? '云端墨水屏' : '热敏打印机'}
                      </span>
                      <span className="ml-2 text-gray-400">
                        {device.width}×{device.height}px
                      </span>
                      {device.kind === 'eink-local' && (
                        <span className="ml-2 text-gray-400">
                          {device.wire_protocol === 'epd1-v1' ? 'EPD1' : '旧裸位图'}
                        </span>
                      )}
                      <span className="ml-2 text-gray-400">
                        token: {device.token ? '已设置' : '未设置'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      device.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {device.enabled ? (
                      <span className="flex items-center gap-1">
                        <Wifi className="w-3 h-3" />
                        启用
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <WifiOff className="w-3 h-3" />
                        禁用
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => {
                      setEditingDevice(device);
                      setModalOpen(true);
                    }}
                    className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(device.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {device.kind === 'eink-local' && device.enabled && (
                    <Link
                      to={`/annotate?device=${encodeURIComponent(device.id)}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg"
                      title="选择一条新闻并推送到这台设备"
                    >
                      <Send className="w-3.5 h-3.5" />
                      去推送
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {modalOpen && (
        <DeviceModal
          device={editingDevice}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
        />
      )}
    </div>
  );
}

function DeviceModal({
  device,
  onClose,
  onSaved,
}: {
  device: Device | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    id: device?.id || '',
    name: device?.name || '',
    base_url: device?.base_url || '',
    token: '',
    width: device?.width || 800,
    height: device?.height || 480,
    enabled: device?.enabled ?? true,
    kind: device?.kind || 'eink-local',
    wire_protocol: device?.wire_protocol || 'legacy-raw-v0',
    color_mode: device?.color_mode || 'mono-1bit',
    plane_count: device?.plane_count || 1,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (device) {
        const patch: Record<string, any> = {
          name: form.name,
          base_url: form.base_url,
          width: form.width,
          height: form.height,
          enabled: form.enabled,
          kind: form.kind,
          wire_protocol: form.wire_protocol,
          color_mode: form.color_mode,
          plane_count: form.plane_count,
        };
        if (form.token) {
          patch.token = form.token;
        }
        return devicesApi.updateDevice(device.id, patch);
      } else {
        return devicesApi.createDevice({
          id: form.id,
          name: form.name,
          base_url: form.base_url,
          token: form.token || undefined,
          width: form.width,
          height: form.height,
          enabled: form.enabled,
          kind: form.kind,
          wire_protocol: form.wire_protocol,
          color_mode: form.color_mode,
          plane_count: form.plane_count,
        });
      }
    },
    onSuccess: () => {
      toast.success(device ? '设备已更新' : '设备已创建');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!device && !form.id) {
      toast.error('设备 ID 不能为空');
      return;
    }
    if (!form.name) {
      toast.error('设备名称不能为空');
      return;
    }
    if (!form.base_url) {
      toast.error('Base URL 不能为空');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            {device ? '编辑设备' : '新建设备'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">设备 ID</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              disabled={!!device}
              placeholder="如 esp32-bedroom"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">设备名称</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如 卧室墨水屏"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="http://192.168.31.37"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">设备类型</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Device['kind'] })}
            >
              <option value="eink-local">本地墨水屏（ESP32）</option>
              <option value="eink-cloud">云端墨水屏（MindReset）</option>
              <option value="thermal-printer">热敏打印机</option>
            </select>
          </div>
          {form.kind === 'eink-local' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">推送协议</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                value={form.wire_protocol}
                onChange={(e) => setForm({ ...form, wire_protocol: e.target.value as NonNullable<Device['wire_protocol']> })}
              >
                <option value="legacy-raw-v0">C3 旧版：裸位图</option>
                <option value="epd1-v1">统一内核：EPD1 v1</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">S3 统一内核固件请选择 EPD1 v1。</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">宽度 (px)</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                value={form.width}
                onChange={(e) => setForm({ ...form, width: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">高度 (px)</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                value={form.height}
                onChange={(e) => setForm({ ...form, height: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Token</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder={device ? '留空则不修改' : '可选'}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="d-enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="d-enabled" className="text-sm text-gray-700">
              启用
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </span>
            ) : (
              '保存'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
