import { BASE_URL } from './client';

const API_BASE = BASE_URL;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export interface NeuromancerReviewScores {
  factualConfidence: number;
  informationDensity: number;
  einkSuitability: number;
}

export const neuromancerReviewApi = {
  async candidates(options: { limit?: number; unreviewed?: boolean } = {}) {
    const query = new URLSearchParams();
    query.set('limit', String(options.limit ?? 50));
    if (options.unreviewed) query.set('unreviewed', 'true');
    return requestJson<any>(`/api/review/neuromancer/candidates?${query.toString()}`);
  },

  async get(runId: string) {
    return requestJson<any>(`/api/review/neuromancer/${encodeURIComponent(runId)}`);
  },

  async saveReview(runId: string, input: {
    choice: 'a' | 'b' | 'tie';
    sideA: NeuromancerReviewScores;
    sideB: NeuromancerReviewScores;
    note?: string;
  }) {
    return requestJson<any>(`/api/review/neuromancer/${encodeURIComponent(runId)}/review`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async saveWorthCost(runId: string, worthCost: boolean) {
    return requestJson<any>(`/api/review/neuromancer/${encodeURIComponent(runId)}/cost`, {
      method: 'PATCH',
      body: JSON.stringify({ worthCost }),
    });
  },
};
