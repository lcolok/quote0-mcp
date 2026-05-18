import axios from 'axios';
import type { Label, GenerateRequest, GenerateImageRequest, GenerateImageResponse, GenerateTextRequest, GenerateTextResponse, WidgetMeta, FontMeta, PrintRequest, LlmModelMeta, ActiveLlmInfo } from '@/types/label';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

const client = axios.create({ baseURL: API_BASE, timeout: 30000 });

export const labelsApi = {
  generate: (req: GenerateRequest) =>
    client
      .post<{ success: boolean; id: string; svg: string; pngUrl: string }>('/labels/generate', req)
      .then((r) => r.data),

  generateImage: (req: GenerateImageRequest) =>
    client
      .post<GenerateImageResponse>('/labels/generate-image', req, { timeout: 10_000 })
      .then((r) => r.data),

  generateText: (req: GenerateTextRequest) =>
    client
      .post<GenerateTextResponse>('/labels/generate-text', req, { timeout: 10_000 })
      .then((r) => r.data),

  fetchWidgets: () =>
    client
      .get<{ success: boolean; widgets: WidgetMeta[] }>('/labels/widgets')
      .then((r) => r.data.widgets),

  fetchFonts: () =>
    client
      .get<{ success: boolean; fonts: FontMeta[] }>('/labels/fonts')
      .then((r) => r.data.fonts),

  list: (params?: { status?: string; tag?: string; limit?: number }) =>
    client
      .get<{ success: boolean; labels: Label[] }>('/labels', { params })
      .then((r) => r.data.labels),

  get: (id: string) =>
    client.get<{ success: boolean; label: Label }>(`/labels/${id}`).then((r) => r.data.label),

  print: (id: string, req?: PrintRequest) =>
    client
      .post<{ success: boolean; printId: string; bytes: number; httpStatus: number }>(
        `/labels/${id}/print`,
        req ?? {}
      )
      .then((r) => r.data),

  regenerate: (id: string) =>
    client
      .post<{ success: boolean; svg: string; pngUrl: string }>(`/labels/${id}/regenerate`)
      .then((r) => r.data),

  redither: (id: string) =>
    client
      .post<{ success: boolean; id: string; pngPath: string; pngUrl: string }>(
        `/labels/${id}/redither`
      )
      .then((r) => r.data),

  delete: (id: string) =>
    client.delete<{ success: boolean }>(`/labels/${id}`).then((r) => r.data),

  fetchLlmModels: () =>
    client
      .get<{ success: boolean; models: LlmModelMeta[] }>('/llm/models')
      .then((r) => r.data.models),

  fetchActiveLlm: () =>
    client
      .get<{ success: boolean } & ActiveLlmInfo>('/llm/active')
      .then((r) => r.data),

  setActiveLlm: (providerId: number, modelDbId: number) =>
    client
      .post<{ success: boolean }>('/llm/active', { providerId, modelDbId })
      .then((r) => r.data),
};
