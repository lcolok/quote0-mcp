export interface ComponentBatchListItem {
  id: string;
  name: string;
  targetId: string;
  status: 'draft' | 'printing' | 'done' | 'archived';
  counts: { total: number; rendered: number; printed: number };
  createdAt: string;
  updatedAt: string;
}

export interface ComponentBatchItem {
  id: string;
  idx: number;
  code: string;
  labelId: string | null;
  pngUrl: string | null;
  labelStatus: string | null;
  printCount: number;
  lastPrintedAt: string | null;
}

export interface ComponentBatchDetail {
  id: string;
  name: string;
  targetId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComponentBatchRequest {
  name: string;
  codes: string[];
  targetId?: string;
}
