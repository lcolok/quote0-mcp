import axios from 'axios';

const BASE_URL = (import.meta as any).env?.VITE_API_URL || (
  (import.meta as any).env?.MODE === 'production' ? '' : 'http://localhost:3001'
);

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export interface LLMProvider {
  id: number;
  slug: string;
  display_name: string;
  base_url: string;
  api_key: string;
  api_type: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  models?: LLMModel[];
}

export interface LLMModel {
  id: number;
  provider_id: number;
  model_id: string;
  display_name: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
  enabled: boolean;
  created_at: string;
}

export interface ActiveSetting {
  active_provider_id: number;
  active_model_id: number;
  provider_slug: string;
  model_id_str: string;
}

export interface TestResult {
  success: boolean;
  latency_ms: number;
  response: string;
  error?: string;
}

class LLMProvidersApiClient {
  async getProviders(): Promise<{ success: boolean; data: LLMProvider[] }> {
    const res = await client.get('/api/llm/providers');
    return res.data;
  }

  async createProvider(body: Omit<LLMProvider, 'id' | 'created_at' | 'updated_at' | 'models'>): Promise<{ success: boolean; data: LLMProvider }> {
    const res = await client.post('/api/llm/providers', body);
    return res.data;
  }

  async updateProvider(id: number, body: Partial<Omit<LLMProvider, 'id' | 'created_at' | 'updated_at' | 'models'>>): Promise<{ success: boolean; data: LLMProvider }> {
    const res = await client.put(`/api/llm/providers/${id}`, body);
    return res.data;
  }

  async deleteProvider(id: number): Promise<{ success: boolean }> {
    const res = await client.delete(`/api/llm/providers/${id}`);
    return res.data;
  }

  async createModel(providerId: number, body: Omit<LLMModel, 'id' | 'created_at'>): Promise<{ success: boolean; data: LLMModel }> {
    const res = await client.post(`/api/llm/providers/${providerId}/models`, body);
    return res.data;
  }

  async updateModel(providerId: number, modelId: number, body: Partial<Omit<LLMModel, 'id' | 'created_at'>>): Promise<{ success: boolean; data: LLMModel }> {
    const res = await client.put(`/api/llm/providers/${providerId}/models/${modelId}`, body);
    return res.data;
  }

  async deleteModel(providerId: number, modelId: number): Promise<{ success: boolean }> {
    const res = await client.delete(`/api/llm/providers/${providerId}/models/${modelId}`);
    return res.data;
  }

  async getActive(): Promise<{ success: boolean; data: ActiveSetting | null }> {
    const res = await client.get('/api/llm/active');
    return res.data;
  }

  async setActive(providerId: number, modelId: number): Promise<{ success: boolean }> {
    const res = await client.post('/api/llm/active', { provider_id: providerId, model_id: modelId });
    return res.data;
  }

  async testProvider(providerId: number, modelId: number): Promise<TestResult> {
    const res = await client.post('/api/llm/test', { provider_id: providerId, model_id: modelId });
    return res.data;
  }
}

export const llmProvidersApi = new LLMProvidersApiClient();
