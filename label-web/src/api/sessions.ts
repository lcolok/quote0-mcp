import axios from 'axios';
import type { SessionTree, PlanResponse } from '@/types/session';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
// rewrite/plan 模式后端要同步调多模态 LLM,放宽超时
const client = axios.create({ baseURL: API_BASE, timeout: 120000 });

export interface PlanRequest {
  parentTurnId?: string | null;
  feedback: string;
  refImageUrls?: string[];
  fresh?: boolean;
  clarifications?: string[];
}

export interface RefineRequest {
  parentTurnId?: string | null;
  feedback: string;
  refImageUrls?: string[];
  genMode: 'img2img' | 'rewrite';
  model?: string;
  presetId?: string | null;
  clientRequestId?: string;
  // 确认后执行形态(来自 /plan,前端可编辑)
  effectivePrompt?: string;
  effectivePromptZh?: string;
  agentReply?: string;
  plannerReasoning?: string;
}

export const sessionsApi = {
  ensure: (subjectId: string) =>
    client
      .post<{ success: boolean; sessionId: string; currentTurnId: string | null }>(
        '/label-sessions/ensure',
        { subjectType: 'batch_item', subjectId }
      )
      .then((r) => r.data),

  get: (id: string) =>
    client.get<{ success: boolean } & SessionTree>(`/label-sessions/${id}`).then((r) => r.data),

  // 意图规划:只分析不生图,返回 agent 提案供交互式确认
  plan: (id: string, body: PlanRequest) =>
    client.post<PlanResponse>(`/label-sessions/${id}/plan`, body).then((r) => r.data),

  refine: (id: string, body: RefineRequest) =>
    client
      .post<{ success: boolean; turnId: string; jobId: string | null }>(
        `/label-sessions/${id}/turns`,
        body
      )
      .then((r) => r.data),

  translatePrompt: (id: string, promptZh: string) =>
    client
      .post<{ success: boolean; prompt: string; promptZh: string; error?: string }>(
        `/label-sessions/${id}/translate-prompt`,
        { promptZh }
      )
      .then((r) => r.data),

  select: (id: string, turnId: string) =>
    client
      .post<{ success: boolean; labelId: string | null }>(`/label-sessions/${id}/select`, { turnId })
      .then((r) => r.data),

  retryTurn: (id: string, turnId: string) =>
    client
      .post<{ success: boolean; jobId: string | null }>(`/label-sessions/${id}/turns/${turnId}/retry`)
      .then((r) => r.data),

  deleteTurn: (id: string, turnId: string) =>
    client
      .delete<{ success: boolean; currentTurnId: string | null }>(`/label-sessions/${id}/turns/${turnId}`)
      .then((r) => r.data),

  restoreTurn: (id: string, turnId: string) =>
    client
      .post<{ success: boolean }>(`/label-sessions/${id}/turns/${turnId}/restore`)
      .then((r) => r.data),
};
