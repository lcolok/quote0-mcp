export interface ImageSendOptions {
  border?: "0" | "1";
  link?: string;
}

export interface DeviceConfig {
  deviceId: string;
  deviceSecret: string;
}

export interface ImagePayload {
  deviceId: string;
  image: string;
  border?: "0" | "1";
  link?: string;
}

export interface ApiResponse {
  success: boolean;
  data?: string;
  error?: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export const DEVICE_SCREEN_SIZE: ImageDimensions = {
  width: 296,
  height: 152
};