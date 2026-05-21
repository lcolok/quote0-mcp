import axios from 'axios';
import type { Memo, CreateMemoRequest, UpdateMemoRequest } from '@/types/memo';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

const client = axios.create({ baseURL: API_BASE, timeout: 30000 });

export const memosApi = {
  list: () =>
    client
      .get<{ success: boolean; memos: Memo[] }>('/memos')
      .then((r) => r.data.memos),

  get: (id: string) =>
    client
      .get<{ success: boolean; memo: Memo }>(`/memos/${id}`)
      .then((r) => r.data.memo),

  create: (req: CreateMemoRequest) =>
    client
      .post<{ success: boolean; memo: Memo; renderOk: boolean; renderError: string | null }>(
        '/memos',
        req
      )
      .then((r) => r.data),

  update: (id: string, req: UpdateMemoRequest) =>
    client
      .patch<{
        success: boolean;
        memo: Memo;
        renderOk: boolean | null;
        renderError: string | null;
      }>(`/memos/${id}`, req)
      .then((r) => r.data),

  delete: (id: string) =>
    client
      .delete<{ success: boolean; id: string }>(`/memos/${id}`)
      .then((r) => r.data),

  render: (id: string) =>
    client
      .post<{ success: boolean; memo: Memo; renderOk: boolean; renderError: string | null }>(
        `/memos/${id}/render`
      )
      .then((r) => r.data),
};
