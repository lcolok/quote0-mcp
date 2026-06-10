export interface BatchListItem {
  id: string;
  name: string;
  generator: string;
  model: string | null;
  status: 'draft' | 'running' | 'review' | 'done' | 'archived';
  templateRev: number;
  counts: { total: number; done: number };
  createdAt: string;
  updatedAt: string;
}

export type BatchItemState = 'pending' | 'running' | 'succeeded' | 'failed';
export type BatchItemReview = 'pending' | 'approved' | 'rejected';

export interface BatchItem {
  id: string;
  idx: number;
  name: string;
  vars: Record<string, any> | null;
  refImageUrls: string[];
  review: BatchItemReview;
  state: BatchItemState;
  lastError: string | null;
  label: { id: string; pngUrl: string | null; status: string } | null;
}

export interface BatchDetail {
  id: string;
  name: string;
  generator: string;
  model: string | null;
  presetId: string | null;
  targetId: string;
  promptTemplate: string;
  templateRev: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBatchRequest {
  name: string;
  generator?: 'image';
  model: string;
  presetId?: string | null;
  targetId?: string;
  promptTemplate: string;
  items: Array<{ name: string; vars?: Record<string, any>; refImageUrls?: string[] }>;
}
