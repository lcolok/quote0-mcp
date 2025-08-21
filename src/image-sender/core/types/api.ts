/**
 * API相关类型定义
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: number;
  requestId?: string;
}

export interface ApiRequest {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export interface DeviceApiResponse {
  message: string;
  deviceId?: string;
  status?: 'success' | 'error' | 'pending';
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  speed?: number; // bytes per second
  estimatedTimeRemaining?: number; // seconds
}