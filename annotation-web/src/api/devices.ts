import axios from 'axios';

const BASE_URL = (import.meta as any).env?.VITE_API_URL || (
  (import.meta as any).env?.MODE === 'production' ? '' : 'http://localhost:3001'
);

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export interface Device {
  id: string;
  name: string;
  base_url: string;
  token: string;
  width: number;
  height: number;
  enabled: boolean;
  kind: 'thermal-printer' | 'eink-local' | 'eink-cloud';
  capabilities?: string[];
  wire_protocol?: 'legacy-raw-v0' | 'epd1-v1';
  color_mode?: 'mono-1bit' | '3-color';
  plane_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDeviceBody {
  id: string;
  name: string;
  base_url: string;
  token?: string;
  width: number;
  height: number;
  enabled?: boolean;
  kind?: Device['kind'];
  capabilities?: string[];
  wire_protocol?: Device['wire_protocol'];
  color_mode?: Device['color_mode'];
  plane_count?: number;
}

export interface UpdateDeviceBody {
  name?: string;
  base_url?: string;
  token?: string;
  width?: number;
  height?: number;
  enabled?: boolean;
  kind?: Device['kind'];
  capabilities?: string[];
  wire_protocol?: Device['wire_protocol'];
  color_mode?: Device['color_mode'];
  plane_count?: number;
}

class DevicesApiClient {
  async getDevices(): Promise<{ success: boolean; data: Device[] }> {
    const res = await client.get('/api/devices');
    return res.data;
  }

  async createDevice(body: CreateDeviceBody): Promise<{ success: boolean; data: Device }> {
    const res = await client.post('/api/devices', body);
    return res.data;
  }

  async updateDevice(id: string, body: UpdateDeviceBody): Promise<{ success: boolean; data: Device }> {
    const res = await client.patch(`/api/devices/${id}`, body);
    return res.data;
  }

  async deleteDevice(id: string): Promise<{ success: boolean }> {
    const res = await client.delete(`/api/devices/${id}`);
    return res.data;
  }
}

export const devicesApi = new DevicesApiClient();
