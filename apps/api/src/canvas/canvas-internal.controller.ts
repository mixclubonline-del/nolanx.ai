import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { CanvasService } from './canvas.service';
import {
  CanvasListResponseDto,
  CanvasResponseDto,
  UpdateCanvasDataDto,
} from './dto/canvas.dto';

@Controller('internal/canvas')
@UseGuards(JwtGuard)
export class CanvasInternalController {
  constructor(private readonly canvasService: CanvasService) {}

  @Get(':id')
  async getCanvasInternal(
    @Param('id') canvasId: string,
  ): Promise<CanvasResponseDto> {
    return this.canvasService.getCanvasByIdForInternal(canvasId);
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateCanvasInternal(
    @Param('id') canvasId: string,
    @Body() body: UpdateCanvasDataDto,
  ): Promise<void> {
    await this.canvasService.updateCanvasDataInternal(canvasId, body);
  }

  @Post()
  async createCanvasInternal(
    @Body() body: { canvas_id?: string; name?: string; user_id?: string },
  ): Promise<CanvasResponseDto> {
    const canvas = await this.canvasService.createCanvas(
      body.user_id || 'local-dev-user',
      {
        canvas_id: body.canvas_id,
        name: body.name || 'Untitled Scene',
      } as any,
    );
    return canvas;
  }

  @Get()
  async listCanvasesInternal(
    @Query('user_id') userId?: string,
  ): Promise<CanvasListResponseDto> {
    return this.canvasService.getUserCanvases(userId || 'local-dev-user', {
      page: '1',
      limit: '100',
      sort: 'updated_at',
      order: 'desc',
    } as any);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCanvasInternal(@Param('id') canvasId: string): Promise<void> {
    const canvas = await this.canvasService.getCanvasByIdForInternal(canvasId);
    await this.canvasService.deleteCanvas(
      canvasId,
      canvas.id ? canvas['user_id'] || 'local-dev-user' : 'local-dev-user',
    );
  }

  @Put(':id/name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async renameCanvasInternal(
    @Param('id') canvasId: string,
    @Body() body: { name: string },
  ): Promise<void> {
    const canvas = await this.canvasService.getCanvasByIdForInternal(canvasId);
    await this.canvasService.renameCanvas(
      canvasId,
      canvas['user_id'] || 'local-dev-user',
      { name: body.name },
    );
  }

  @Post(':id/timeline/asset')
  async addTimelineAssetInternal(
    @Param('id') canvasId: string,
    @Body() body: { assetType: string; assetData: any },
  ): Promise<{ success: boolean; canvas: CanvasResponseDto }> {
    const canvas = await this.canvasService.addTimelineAssetInternal(
      canvasId,
      body.assetType,
      body.assetData,
    );
    return { success: true, canvas };
  }

  @Put(':id/timeline/asset/:assetId')
  async updateTimelineAssetInternal(
    @Param('id') canvasId: string,
    @Param('assetId') assetId: string,
    @Body() body: Record<string, any>,
  ): Promise<{ success: boolean; canvas: CanvasResponseDto }> {
    const canvas = await this.canvasService.updateTimelineAssetInternal(
      canvasId,
      assetId,
      body,
    );
    return { success: true, canvas };
  }

  @Delete(':id/timeline/asset/:assetId')
  async deleteTimelineAssetInternal(
    @Param('id') canvasId: string,
    @Param('assetId') assetId: string,
  ): Promise<{ success: boolean; canvas: CanvasResponseDto }> {
    const canvas = await this.canvasService.deleteTimelineAssetInternal(
      canvasId,
      assetId,
    );
    return { success: true, canvas };
  }
}
