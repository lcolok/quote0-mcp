export type MemoStatus = 'draft' | 'rendering' | 'ready' | 'failed';
export type MemoTargetRenderer = 'device' | 'local-eink' | 'both';

export interface Memo {
  id: string;
  text: string;
  enabled: boolean;
  sortOrder: number;
  pngPath: string | null;
  pngUrl: string | null;
  targetId: string | null;
  widgetId: string | null;
  fontFamily: string | null;
  status: MemoStatus;
  lastError: string | null;
  renderLatencyMs: number | null;
  targetRenderer: MemoTargetRenderer;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoRequest {
  text: string;
  enabled?: boolean;
  sortOrder?: number;
  targetRenderer?: MemoTargetRenderer;
}

export interface UpdateMemoRequest {
  text?: string;
  enabled?: boolean;
  sortOrder?: number;
  targetRenderer?: MemoTargetRenderer;
}
