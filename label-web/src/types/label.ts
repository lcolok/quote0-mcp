export type DitherAlgorithm =
  | 'threshold'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'stucki'
  | 'burkes'
  | 'sierra'
  | 'sierra-2'
  | 'sierra-lite'
  | 'bayer-4x4'
  | 'bayer-8x8'
  | 'bayer-16x16'
  | 'blue-noise';

export interface Label {
  id: string;
  prompt: string;
  svg?: string;
  pngPath: string;
  pngUrl: string;
  targetId: string;
  status: 'draft' | 'approved' | 'printed' | 'archived' | 'generating' | 'failed';
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
  sourceType?: 'svg' | 'component' | 'image' | 'widget';
  sourceModel?: string | null;
  sourceImageUrl?: string | null;
  lastError?: string | null;
  widgetProps?: Record<string, any> | null;
  fontFamily?: string | null;
  iconSvg?: string | null;
  frameSvgPaths?: string[] | null;
  decoratorCode?: string | null;
  parentRevisionId?: string | null;
  ditherAlgorithm?: DitherAlgorithm;
}

export interface GenerateImageResponse {
  success: boolean;
  jobId: string;
  state: string;
  createdAt: string;
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
  clientRequestId?: string;
  presetId?: string;
  refImageUrls?: string[];
}

export interface GenerateTextRequest {
  prompt: string;
  targetId?: string;
  tags?: string[];
  preferredWidget?: 'text-single' | 'text-two-lines' | 'text-with-icon' | 'price-tag';
  preferredFont?: 'smiley-sans' | 'lxgw-wenkai' | 'alibaba-puhuiti';
  forceDecoration?: boolean;
}

export interface GenerateTextResponse {
  success: boolean;
  jobId: string;
  state: string;
  createdAt: string;
}

export interface WidgetMeta {
  id: string;
  displayName: string;
  description: string;
  propsSchema: Array<{
    name: string;
    type: string;
    required: boolean;
    maxLength?: number;
    description: string;
  }>;
  defaultProps: Record<string, any>;
}

export interface FontMeta {
  family: string;
  displayName: string;
  description: string;
}

export interface PrintRequest {
  niimbotEndpoint?: string;
  deviceId?: string;
}

export interface LlmModelMeta {
  providerId: number;
  providerSlug: string;
  providerDisplayName: string;
  modelDbId: number;
  modelId: string;
  modelDisplayName: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

export interface LabelJob {
  id: string;
  jobType: 'widget' | 'image';
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  labelId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ActiveLlmInfo {
  activeProviderId: number;
  activeModelDbId: number;
  providerSlug: string;
  modelId: string;
  modelDisplayName: string;
}

export interface ImagePreset {
  id: string;
  name: string;
  prompt: string;
  model: string | null;
  modelOptions: Record<string, any> | null;
  thumbnailUrl: string | null;
  sourceImageUrl: string | null;
  sourceLabelId: string | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
  styleMode: 'oneshot' | 'static_suffix';
  staticSuffixText: string | null;
  displayOrder: number;
}

export interface CreatePresetRequest {
  name: string;
  prompt: string;
  model?: string | null;
  modelOptions?: Record<string, any> | null;
  sourceLabelId?: string | null;
}

export interface UpdatePresetRequest {
  name?: string;
  prompt?: string;
  model?: string | null;
  staticSuffixText?: string | null;
}

export interface RefImageUploadResponse {
  success: boolean;
  url: string;
  sizeBytes: number;
  contentType: string;
}

export interface CurrentTargetInfo {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  deviceType?: number;
  dpi?: number;
  modelName?: string;
  sku?: string;
  rfidBarcode?: string;
  totalMm?: number;
  usedMm?: number;
  remainingMm?: number;
  device?: {
    model: string;
    battery: number;
    serial: string;
    swVersion: string;
  } | null;
  source: 'spec-local' | 'spec-cloud' | 'default';
}

export interface DitherBatchPreviewItem {
  algorithm: string;
  pngBase64: string;
}

export interface DitherBatchTargetInfo {
  deviceType: number;
  dpi: number;
  modelName: string;
  printWidthPx: number;
  printHeightPx: number;
  previewWidthPx: number;
  previewHeightPx: number;
}

export interface DitherBatchPreviewResponse {
  success: boolean;
  target: DitherBatchTargetInfo;
  previews: DitherBatchPreviewItem[];
}
