import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RuntimeConfigService } from './runtime-config.service';
import { RuntimeConfigData } from './runtime-config.types';

@Controller('runtime-config')
@UseGuards(JwtGuard)
export class RuntimeConfigController {
  constructor(private readonly runtimeConfigService: RuntimeConfigService) {}

  @Get()
  getConfig() {
    return {
      config: this.runtimeConfigService.getEditableConfig(),
      status: this.runtimeConfigService.getStatus(),
    };
  }

  @Put()
  updateConfig(@Body() body: Partial<RuntimeConfigData>) {
    return this.runtimeConfigService.updateConfig(body || {});
  }

  @Post()
  updateConfigPost(@Body() body: Partial<RuntimeConfigData>) {
    return this.runtimeConfigService.updateConfig(body || {});
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async uploadFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const result = await this.runtimeConfigService.uploadFile(file);
    return {
      url: result.url,
      key: result.key,
      mime_type: file.mimetype,
      size: file.size,
    };
  }
}
