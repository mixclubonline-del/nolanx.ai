import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ResolvedRuntimeConfig, RuntimeConfigData, RuntimeConfigStatus } from './runtime-config.types';

@Injectable()
export class RuntimeConfigService {
  private readonly dataDir: string;
  private readonly configPath: string;

  constructor(private readonly configService: ConfigService) {
    this.dataDir = path.resolve(
      process.cwd(),
      this.configService.get<string>('NOLANX_LOCAL_DATA_DIR') || 'data',
    );
    this.configPath = path.join(this.dataDir, 'runtime-config.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.ensureConfigFile();
  }

  private ensureConfigFile() {
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, '{}\n', 'utf8');
    }
  }

  private readStoredConfig(): RuntimeConfigData {
    this.ensureConfigFile();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeStoredConfig(data: RuntimeConfigData) {
    fs.writeFileSync(this.configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  private trim(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private envValue(name: string): string {
    return this.trim(this.configService.get<string>(name));
  }

  getEditableConfig(): RuntimeConfigData {
    const stored = this.readStoredConfig();
    return {
      openrouter_api_key: stored.openrouter_api_key || this.envValue('OPENROUTER_API_KEY'),
      openrouter_model: stored.openrouter_model || this.envValue('OPENROUTER_MODEL') || 'google/gemini-3.5-flash',
      image_api_key: stored.image_api_key || this.envValue('IMAGE_API_KEY') || this.envValue('FAL_KEY') || this.envValue('REELMIND_FAL_KEY'),
      image_model: stored.image_model || this.envValue('IMAGE_MODEL') || 'openai/gpt-image-2',
      image_edit_model: stored.image_edit_model || this.envValue('IMAGE_EDIT_MODEL') || 'openai/gpt-image-2',
      video_api_key: stored.video_api_key || this.envValue('VIDEO_API_KEY') || this.envValue('REELMIND_VIDEO_API_KEY'),
      video_model: stored.video_model || this.envValue('VIDEO_MODEL') || 'dreamina-seedance-2-0-260128',
      r2_account_id: stored.r2_account_id || this.envValue('R2_ACCOUNT_ID'),
      r2_access_key_id: stored.r2_access_key_id || this.envValue('R2_ACCESS_KEY_ID'),
      r2_secret_access_key: stored.r2_secret_access_key || this.envValue('R2_SECRET_ACCESS_KEY'),
      r2_bucket_name: stored.r2_bucket_name || this.envValue('R2_BUCKET_NAME'),
      r2_public_url: stored.r2_public_url || this.envValue('R2_PUBLIC_URL'),
    };
  }

  getResolvedConfig(): ResolvedRuntimeConfig {
    const editable = this.getEditableConfig();
    const appUrl = this.envValue('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';

    return {
      openrouter: {
        api_key: this.trim(editable.openrouter_api_key),
        model: this.trim(editable.openrouter_model) || 'google/gemini-3.5-flash',
        url: 'https://openrouter.ai/api/v1',
        site_url: appUrl,
        site_name: 'NolanX',
        max_tokens: 8192,
        disable_streaming: true,
      },
      image: {
        provider: 'fal_ai',
        api_key: this.trim(editable.image_api_key),
        model: this.trim(editable.image_model) || 'openai/gpt-image-2',
        edit_model: this.trim(editable.image_edit_model) || 'openai/gpt-image-2',
      },
      video: {
        provider: 'reelmind',
        api_key: this.trim(editable.video_api_key),
        model: this.trim(editable.video_model) || 'dreamina-seedance-2-0-260128',
        endpoint: 'https://nestapi.reelmind.ai/external-api/video/generate',
        task_endpoint_base: 'https://nestapi.reelmind.ai/external-api/video/task',
      },
      r2_storage: {
        account_id: this.trim(editable.r2_account_id),
        access_key_id: this.trim(editable.r2_access_key_id),
        secret_access_key: this.trim(editable.r2_secret_access_key),
        bucket_name: this.trim(editable.r2_bucket_name),
        public_url: this.trim(editable.r2_public_url).replace(/\/$/, ''),
      },
    };
  }

  getStatus(): RuntimeConfigStatus {
    const config = this.getResolvedConfig();
    const missing: string[] = [];

    if (!config.openrouter.api_key) missing.push('OPENROUTER_API_KEY');
    if (!config.image.api_key) missing.push('IMAGE_API_KEY');
    if (!config.video.api_key) missing.push('VIDEO_API_KEY');

    const chatReady = Boolean(config.openrouter.api_key);
    const imageReady = Boolean(config.image.api_key);
    const videoReady = Boolean(config.video.api_key);
    const enhancedStorageReady = Boolean(
      config.r2_storage.account_id &&
      config.r2_storage.access_key_id &&
      config.r2_storage.secret_access_key &&
      config.r2_storage.bucket_name &&
      config.r2_storage.public_url,
    );
    const uploadsReady = true;

    const textReady = chatReady;
    const scriptReady = chatReady;
    const mode: RuntimeConfigStatus['mode'] = enhancedStorageReady && videoReady
      ? 'enhanced-r2'
      : videoReady
        ? 'full-video'
        : imageReady
          ? 'script-plus-image'
          : 'text-only';

    return {
      mode,
      textReady,
      scriptReady,
      chatReady,
      imageReady,
      videoReady,
      uploadsReady,
      enhancedStorageReady,
      fullyReady: chatReady && imageReady && videoReady,
      missing,
    };
  }

  updateConfig(input: Partial<RuntimeConfigData>) {
    const current = this.readStoredConfig();
    const next: RuntimeConfigData = {
      ...current,
      ...Object.fromEntries(
        Object.entries(input || {}).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
      ),
    };
    this.writeStoredConfig(next);
    return {
      config: this.getEditableConfig(),
      status: this.getStatus(),
    };
  }

  private getR2Client() {
    const r2 = this.getResolvedConfig().r2_storage;
    if (!r2.account_id || !r2.access_key_id || !r2.secret_access_key || !r2.bucket_name || !r2.public_url) {
      throw new Error('R2 configuration is incomplete');
    }

    return {
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${r2.account_id}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2.access_key_id,
          secretAccessKey: r2.secret_access_key,
        },
      }),
      bucketName: r2.bucket_name,
      publicUrl: r2.public_url,
    };
  }

  async uploadFile(file: Express.Multer.File): Promise<{ url: string; key: string }> {
    if (!file) {
      throw new Error('File is required');
    }

    const { client, bucketName, publicUrl } = this.getR2Client();
    const extension = path.extname(file.originalname || '').toLowerCase();
    const baseName = path.basename(file.originalname || 'upload', extension)
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'upload';
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${baseName}${extension}`;

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    }));

    return {
      key,
      url: `${publicUrl}/${key}`,
    };
  }
}
