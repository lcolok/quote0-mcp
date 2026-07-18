import axios from 'axios';
import type {
  ComponentBatchListItem,
  ComponentBatchDetail,
  ComponentBatchItem,
  CreateComponentBatchRequest,
} from '@/types/component-batch';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
const client = axios.create({ baseURL: API_BASE, timeout: 30000 });

export const componentBatchesApi = {
  create: (req: CreateComponentBatchRequest) =>
    client
      .post<{ success: boolean; id: string; count: number }>('/component-label-batches', req)
      .then((r) => r.data),

  list: () =>
    client
      .get<{ success: boolean; batches: ComponentBatchListItem[] }>('/component-label-batches')
      .then((r) => r.data.batches),

  get: (id: string) =>
    client
      .get<{ success: boolean; batch: ComponentBatchDetail; items: ComponentBatchItem[] }>(
        `/component-label-batches/${id}`
      )
      .then((r) => r.data),

  render: (id: string) =>
    client
      .post<{ success: boolean; rendered: number }>(`/component-label-batches/${id}/render`)
      .then((r) => r.data),

  print: (id: string, body: { scope?: any; deviceId: string }) =>
    client
      .post<{
        success: boolean;
        printed: number;
        results?: Array<{ itemId: string; code: string; widgetId?: string; ok: boolean; httpStatus?: number; error?: string }>;
      }>(`/component-label-batches/${id}/print`, body)
      .then((r) => r.data),

  /** 给批次内某条目建/改「数值+封装」配对，之后打印会连配对标签一起打印 */
  pair: (batchId: string, itemId: string, body: { value: string; package: string }) =>
    client
      .post<{ success: boolean }>(`/component-label-batches/${batchId}/items/${itemId}/pair`, body)
      .then((r) => r.data),
};
