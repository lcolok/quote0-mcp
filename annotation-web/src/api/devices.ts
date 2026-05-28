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
}

export interface UpdateDeviceBody {
  name?: string;
  base_url?: string;
  token?: string;
  width?: number;
  height?: number;
  enabled?: boolean;
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
