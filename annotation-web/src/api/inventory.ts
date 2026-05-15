import axios from 'axios';

const BASE_URL = (import.meta as any).env?.VITE_API_URL || (
  (import.meta as any).env?.MODE === 'production' ? '' : 'http://localhost:3001'
);

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export interface InventoryItem {
  id: number;
  producer_job_id: string;
  content_type: string;
  source: string | null;
  category: string | null;
  fingerprint: string | null;
  title: string | null;
  link: string | null;
  raw_content: any;
  processed_content: any;
  image_path: string;
  state: 'ready' | 'pushed' | 'expired';
  replay_count: number;
  max_replays: number;
  created_at: string;
  last_pushed_at: string | null;
  expires_at: string | null;
}

export interface InventoryStats {
  byState: Array<{ state: string; count: string }>;
  bySource: Array<{ source: string; count: string }>;
}

class InventoryApiClient {
  async getInventory(params?: {
    state?: string;
    source?: string;
    limit?: number;
    offset?: number;
    sort_by?: string;
  }): Promise<{ success: boolean; data: InventoryItem[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> {
    const res = await client.get('/api/inventory', { params });
    return res.data;
  }

  async getInventoryStats(): Promise<{ success: boolean; data: InventoryStats }> {
    const res = await client.get('/api/inventory/stats');
    return res.data;
  }

  async getInventoryItem(id: number): Promise<{ success: boolean; data: InventoryItem }> {
    const res = await client.get(`/api/inventory/${id}`);
    return res.data;
  }

  async deleteInventoryItem(id: number): Promise<{ success: boolean }> {
    const res = await client.delete(`/api/inventory/${id}`);
    return res.data;
  }

  async updateState(id: number, state: 'ready' | 'pushed' | 'expired'): Promise<{ success: boolean }> {
    const res = await client.patch(`/api/inventory/${id}/state`, { state });
    return res.data;
  }

  async expireItem(id: number): Promise<{ success: boolean }> {
    const res = await client.patch(`/api/inventory/${id}/expire`);
    return res.data;
  }

  async cleanupExpired(): Promise<{ success: boolean; deleted: number }> {
    const res = await client.post('/api/inventory/cleanup-expired');
    return res.data;
  }
}

export const inventoryApi = new InventoryApiClient();
