export interface Label {
  id: string;
  prompt: string;
  svg?: string;
  pngPath: string;
  pngUrl: string;
  targetId: string;
  status: 'draft' | 'approved' | 'printed' | 'archived';
  printCount: number;
  printHistory: Array<{
    printedAt: string;
    niimbotEndpoint: string;
    printId: string;
    httpStatus: number;
  }>;
  tags: string[];
  llmModel?: string;
  llmLatencyMs?: number;
  createdAt: string;
  updatedAt: string;
  sourceType?: 'svg' | 'component' | 'image';
  sourceModel?: string | null;
  sourceImageUrl?: string | null;
}

export interface GenerateRequest {
  prompt: string;
  targetId?: string;
  tags?: string[];
}

export interface GenerateImageRequest {
  prompt: string;
  model: 'sd5' | 'sd5-3k' | 'nb2' | 'nbp' | 'gpt2';
  targetId?: string;
  tags?: string[];
  modelOptions?: Record<string, any>;
}

export interface PrintRequest {
  niimbotEndpoint?: string;
}
