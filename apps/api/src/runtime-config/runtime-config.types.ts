export interface RuntimeConfigData {
  openrouter_api_key?: string;
  openrouter_model?: string;
  image_api_key?: string;
  image_model?: string;
  image_edit_model?: string;
  video_api_key?: string;
  video_model?: string;
  r2_account_id?: string;
  r2_access_key_id?: string;
  r2_secret_access_key?: string;
  r2_bucket_name?: string;
  r2_public_url?: string;
}

export interface RuntimeConfigStatus {
  mode: 'text-only' | 'script-plus-image' | 'full-video' | 'enhanced-r2';
  textReady: boolean;
  scriptReady: boolean;
  chatReady: boolean;
  imageReady: boolean;
  videoReady: boolean;
  uploadsReady: boolean;
  enhancedStorageReady: boolean;
  fullyReady: boolean;
  missing: string[];
}

export interface ResolvedRuntimeConfig {
  openrouter: {
    api_key: string;
    model: string;
    url: string;
    site_url: string;
    site_name: string;
    max_tokens: number;
    disable_streaming: boolean;
  };
  image: {
    provider: 'fal_ai';
    api_key: string;
    model: string;
    edit_model: string;
  };
  video: {
    provider: 'reelmind';
    api_key: string;
    model: string;
    endpoint: string;
    task_endpoint_base: string;
  };
  r2_storage: {
    account_id: string;
    access_key_id: string;
    secret_access_key: string;
    bucket_name: string;
    public_url: string;
  };
}
