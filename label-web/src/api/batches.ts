import axios from 'axios';
import type { BatchListItem, BatchDetail, BatchItem, CreateBatchRequest } from '@/types/batch';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
const client = axios.create({ baseURL: API_BASE, timeout: 30000 });

export const batchesApi = {
  create: (req: CreateBatchRequest) =>
    client.post<{ success: boolean; id: string }>('/label-batches', req).then((r) => r.data),

  list: () =>
    client
      .get<{ success: boolean; batches: BatchListItem[] }>('/label-batches')
      .then((r) => r.data.batches),

  get: (id: string) =>
    client
      .get<{ success: boolean; batch: BatchDetail; items: BatchItem[] }>(`/label-batches/${id}`)
      .then((r) => r.data),

  patch: (
    id: string,
    req: Partial<Pick<BatchDetail, 'name' | 'model' | 'presetId' | 'targetId' | 'promptTemplate'>>
  ) =>
    client
      .patch<{ success: boolean; templateRev: number }>(`/label-batches/${id}`, req)
      .then((r) => r.data),

  run: (id: string, body: { scope: any; sampleSize?: number }) =>
    client
      .post<{ success: boolean; enqueued: number }>(`/label-batches/${id}/run`, body)
      .then((r) => r.data),

  retry: (id: string, body: { scope: any }) =>
    client
      .post<{ success: boolean; enqueued: number }>(`/label-batches/${id}/retry`, body)
      .then((r) => r.data),

  review: (id: string, itemId: string, review: 'approved' | 'rejected' | 'pending') =>
    client
      .post<{ success: boolean }>(`/label-batches/${id}/items/${itemId}/review`, { review })
      .then((r) => r.data),

  print: (id: string, body: { scope: any; niimbotEndpoint?: string }) =>
    client
      .post<{
        success: boolean;
        printed: number;
        results?: Array<{ labelId: string; ok: boolean; httpStatus?: number; error?: string }>;
      }>(`/label-batches/${id}/print`, body)
      .then((r) => r.data),
};
