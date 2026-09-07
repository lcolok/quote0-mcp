export const REVIEW_URL_CONTRACT_VERSION = '1';

export type ReviewView = 'content' | 'neuromancer';
export type ReviewMode = 'content' | 'renderers';
export type ReviewPane = 'list' | 'preview' | 'actions';

export interface ReviewUrlState {
  version: string;
  view: ReviewView;
  subject?: string;
  delivery?: number;
  mode: ReviewMode;
  target: string;
  pane: ReviewPane;
  query: string;
  deviceIds: string[];
  runId?: string;
  inventoryId?: number;
}

function cleanString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value: string | null | undefined): number | undefined {
  const parsed = Number.parseInt(cleanString(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function enumValue<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  const normalized = cleanString(value) as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

export function parseReviewUrlState(params: URLSearchParams): ReviewUrlState {
  const devices = [...new Set(params.getAll('device').map(cleanString).filter(Boolean))];
  return {
    version: cleanString(params.get('v')) || REVIEW_URL_CONTRACT_VERSION,
    view: enumValue(params.get('view'), ['content', 'neuromancer'] as const, 'content'),
    subject: cleanString(params.get('subject')) || undefined,
    delivery: positiveInt(params.get('delivery')),
    mode: enumValue(params.get('mode'), ['content', 'renderers'] as const, 'content'),
    target: cleanString(params.get('target')) || 'eink-296x152',
    pane: enumValue(params.get('pane'), ['list', 'preview', 'actions'] as const, 'list'),
    query: params.get('q') || '',
    deviceIds: devices,
    runId: cleanString(params.get('run')) || undefined,
    inventoryId: positiveInt(params.get('inventory')),
  };
}

export interface ReviewUrlPatch {
  view?: ReviewView | null;
  subject?: string | null;
  delivery?: number | null;
  mode?: ReviewMode | null;
  target?: string | null;
  pane?: ReviewPane | null;
  query?: string | null;
  deviceIds?: string[] | null;
  runId?: string | null;
  inventoryId?: number | null;
  page?: number | null;
}

function setScalar(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') params.delete(key);
  else params.set(key, String(value));
}

/**
 * Patch URL state without copying volatile data into the address bar.
 * The URL is an identity/view contract, not a serialization of component state.
 */
export function patchReviewUrlParams(current: URLSearchParams, patch: ReviewUrlPatch): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('v', REVIEW_URL_CONTRACT_VERSION);
  if ('view' in patch) setScalar(next, 'view', patch.view);
  if ('subject' in patch) setScalar(next, 'subject', cleanString(patch.subject));
  if ('delivery' in patch) setScalar(next, 'delivery', patch.delivery);
  if ('mode' in patch) setScalar(next, 'mode', patch.mode);
  if ('target' in patch) setScalar(next, 'target', cleanString(patch.target));
  if ('pane' in patch) setScalar(next, 'pane', patch.pane);
  if ('query' in patch) setScalar(next, 'q', patch.query || null);
  if ('runId' in patch) setScalar(next, 'run', cleanString(patch.runId));
  if ('inventoryId' in patch) setScalar(next, 'inventory', patch.inventoryId);
  if ('page' in patch) setScalar(next, 'page', patch.page && patch.page > 0 ? patch.page : null);
  if ('deviceIds' in patch) {
    next.delete('device');
    for (const id of [...new Set((patch.deviceIds || []).map(cleanString).filter(Boolean))]) next.append('device', id);
  }
  return next;
}

export function parseHistoryUrlState(params: URLSearchParams): {
  delivery?: number;
  query: string;
  page: number;
} {
  const rawPage = Number.parseInt(cleanString(params.get('page')), 10);
  return {
    delivery: positiveInt(params.get('delivery')),
    query: params.get('q') || '',
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0,
  };
}
