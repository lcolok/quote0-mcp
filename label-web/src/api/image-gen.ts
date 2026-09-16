import axios from 'axios';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

const client = axios.create({ baseURL: API_BASE, timeout: 15000 });

export interface ImageGenConfig {
  defaultTuziModel: string;
  availableTuziModels: string[];
  source: 'db' | 'env' | 'fallback';
}

export const imageGenApi = {
  /** 读后台可配置的出图默认模型 + 上游实时可出图目录 */
  getConfig: () =>
    client
      .get<{ success: boolean } & ImageGenConfig>('/image-gen/config')
      .then((r) => r.data),
};
