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
}

export interface GenerateRequest {
  prompt: string;
  targetId?: string;
  tags?: string[];
}

export interface PrintRequest {
  niimbotEndpoint?: string;
}
