import axios from 'axios';
import type { Device, CreateDeviceRequest } from '@/types/device';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
const client = axios.create({ baseURL: API_BASE, timeout: 30000 });

export const devicesApi = {
  list: () => client.get<{ success: boolean; data: Device[] }>('/devices').then(r => r.data.data),
  create: (req: CreateDeviceRequest) => client.post<{ success: boolean; data: Device }>('/devices', req).then(r => r.data.data),
  update: (id: string, patch: Partial<Device>) => client.patch<{ success: boolean; data: Device }>(`/devices/${id}`, patch).then(r => r.data.data),
  remove: (id: string) => client.delete(`/devices/${id}`).then(r => r.data),
};
