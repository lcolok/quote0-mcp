import axios from 'axios';
import type { Label, GenerateRequest, GenerateImageRequest, GenerateImageResponse, GenerateTextRequest, GenerateTextResponse, WidgetMeta, FontMeta, PrintRequest, LlmModelMeta, ActiveLlmInfo, LabelJob, ImagePreset, CreatePresetRequest, UpdatePresetRequest, CurrentTargetInfo, RefImageUploadResponse } from '@/types/label';

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

  redither: (id: string, algorithm?: string) =>
    client
      .post<{ success: boolean; id: string; pngPath: string; pngUrl: string; ditherAlgorithm: string }>(
        `/labels/${id}/redither`,
        algorithm ? { algorithm } : {}
      )
      .then((r) => r.data),

  regenDecoration: (id: string) =>
    client
      .post<{ success: boolean; id: string; frameSvgPaths: string[]; pngUrl: string }>(
        `/labels/${id}/regen-decoration`
      )
      .then((r) => r.data),

  getJob: (jobId: string) =>
    client.get<LabelJob>(`/labels/jobs/${jobId}`).then((r) => r.data),

  delete: (id: string) =>
    client.delete<{ success: boolean }>(`/labels/${id}`).then((r) => r.data),

  // v1.4.4 LLM 切换 —— 走 pre-existing /api/llm/* (llm-providers-api.ts)
  fetchLlmModels: () =>
    client
      .get<{ success: boolean; models: LlmModelMeta[] }>('/llm/catalog')
      .then((r) => r.data.models),

  fetchActiveLlm: () =>
    client
      .get<{
        success: boolean;
        data: {
          active_provider_id: number;
          active_model_id: number;
          provider_slug: string;
          model_id_str: string;
        } | null;
      }>('/llm/active')
      .then((r): ActiveLlmInfo | null => {
        if (!r.data.data) return null;
        return {
          activeProviderId: r.data.data.active_provider_id,
          activeModelDbId: r.data.data.active_model_id,
          providerSlug: r.data.data.provider_slug,
          modelId: r.data.data.model_id_str,
          modelDisplayName: r.data.data.model_id_str,
        };
      }),

  setActiveLlm: (providerId: number, modelDbId: number) =>
    client
      .post<{ success: boolean }>('/llm/active', { provider_id: providerId, model_id: modelDbId })
      .then((r) => r.data),

  listPresets: () =>
    client.get<{ success: boolean; presets: ImagePreset[] }>('/labels/presets').then((r) => r.data.presets),

  createPreset: (req: CreatePresetRequest) =>
    client.post<{ success: boolean; id: string; createdAt: string }>('/labels/presets', req).then((r) => r.data),

  updatePreset: (id: string, req: UpdatePresetRequest) =>
    client.patch<{ success: boolean }>(`/labels/presets/${id}`, req).then((r) => r.data),

  deletePreset: (id: string) =>
    client.delete<{ success: boolean }>(`/labels/presets/${id}`).then((r) => r.data),

  recordUsePreset: (id: string) =>
    client.post<{ success: boolean }>(`/labels/presets/${id}/use`, {}).then((r) => r.data),

  duplicatePreset: (id: string) =>
    client.post<{ success: boolean; id: string; createdAt: string }>(`/labels/presets/${id}/duplicate`, {}).then((r) => r.data),

  getCurrentTarget: () =>
    client
      .get<{ success: boolean; target?: CurrentTargetInfo; fallback?: CurrentTargetInfo; error?: string }>('/labels/current-target')
      .then((r) => r.data),

  uploadRefImage: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return client
      .post<RefImageUploadResponse>('/labels/ref-images', fd, { timeout: 30_000 })
      .then((r) => r.data);
  },
};
