import {
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { ChatService } from '../chat/chat.service';
import {
  UpdateCanvasDataDto,
  RenameCanvasDto,
  CanvasResponseDto,
  CanvasListResponseDto,
  CanvasQueryDto,
  CanvasStatsDto,
} from './dto/canvas.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';

@Controller('canvas')
@UseGuards(JwtGuard)
export class CanvasController {
  constructor(
    private readonly canvasService: CanvasService,
    private readonly chatService: ChatService,
  ) {}

  private buildRegeneratePrompt(asset: any, modifyPrompt?: string): string {
    const parts = [
      String(asset?.metadata?.prompt || '').trim(),
      String(asset?.content?.description || '').trim(),
      String(asset?.metadata?.storyboard?.aestheticNotes || '').trim(),
      String(asset?.metadata?.storyboard?.compositionNotes || '').trim(),
      String(asset?.metadata?.storyboard?.cameraLanguage || '').trim(),
      String(asset?.metadata?.storyboard?.voiceDirection || '').trim(),
      String(modifyPrompt || '').trim(),
    ].filter(Boolean);

    return (
      parts.join(' | ').slice(0, 2500) ||
      'Preserve the existing shot intent and regenerate this asset with cleaner continuity.'
    );
  }

  private appendEditHistory(asset: any, entry: Record<string, any>) {
    if (!asset.metadata) {
      asset.metadata = {};
    }
    if (!Array.isArray(asset.metadata.editHistory)) {
      asset.metadata.editHistory = [];
    }
    asset.metadata.editHistory.push(entry);
  }

  private updateAssetTimestamps(asset: any) {
    const now = new Date().toISOString();
    asset.updated_at = now;
    asset.metadata = asset.metadata || {};
    asset.metadata.lastEdited = now;
    return now;
  }

  /**
   * 创建新的Canvas并启动聊天
   * POST /canvas
   */
  @Post('create')
  async createCanvas(
    @Request() req: any,
    @Body() payload: any,
  ): Promise<{ canvas_id: string; session_id?: string }> {
    const userId = req.user?.id;
    // 创建Canvas，后端生成canvas_id
    const canvas = await this.canvasService.createCanvas(userId, payload);

    const sessionId = await this.chatService.createSessionAndStartChat({
      user_id: userId,
      canvas_id: canvas.id,
      preferred_language: payload.preferred_language,
      messages: payload.messages,
    });

    return {
      canvas_id: canvas.id,
      session_id: sessionId,
    };
  }

  /**
   * 获取用户的Canvas列表
   * GET /canvas
   */
  @Get()
  async getUserCanvases(
    @Request() req: any,
    @Query() queryDto: CanvasQueryDto,
  ): Promise<CanvasListResponseDto> {
    const userId = req.user?.id;
    return this.canvasService.getUserCanvases(userId, queryDto);
  }

  /**
   * 获取Canvas详情
   * GET /canvas/:id
   */
  @Get(':id')
  async getCanvas(
    @Request() req: any,
    @Param('id') canvasId: string,
  ): Promise<CanvasResponseDto> {
    const userId = req.user?.id;
    return this.canvasService.getCanvasById(canvasId, userId);
  }

  /**
   * 更新Canvas数据（保存绘图数据）
   * PUT /canvas/:id
   */
  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateCanvasData(
    @Request() req: any,
    @Param('id') canvasId: string,
    @Body() updateDataDto: UpdateCanvasDataDto,
  ): Promise<void> {
    const userId = req.user?.id;
    await this.canvasService.updateCanvasData(canvasId, userId, updateDataDto);
  }

  /**
   * 重命名Canvas
   * POST /canvas/:id/rename
   */
  @Post(':id/rename')
  @HttpCode(HttpStatus.NO_CONTENT)
  async renameCanvas(
    @Request() req: any,
    @Param('id') canvasId: string,
    @Body() renameDto: RenameCanvasDto,
  ): Promise<void> {
    const userId = req.user?.id;
    await this.canvasService.renameCanvas(canvasId, userId, renameDto);
  }

  /**
   * 删除Canvas
   * POST /canvas/:id/delete
   */
  @Post(':id/delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCanvas(
    @Request() req: any,
    @Param('id') canvasId: string,
  ): Promise<void> {
    const userId = req.user?.id;
    await this.canvasService.deleteCanvas(canvasId, userId);
  }

  /**
   * 获取用户Canvas统计信息
   * GET /canvas/stats/summary
   */
  @Get('stats/summary')
  async getUserCanvasStats(@Request() req: any): Promise<CanvasStatsDto> {
    const userId = req.user?.id;
    return this.canvasService.getUserCanvasStats(userId);
  }

  /**
   * 保存Canvas数据（兼容jaaz项目）
   * POST /canvas/:id/save
   */
  @Post(':id/save')
  async saveCanvasData(
    @Request() req: any,
    @Param('id') canvasId: string,
    @Body() body: { data: any; thumbnail?: string },
  ): Promise<{ id: string }> {
    const userId = req.user?.id;

    try {
      await this.canvasService.updateCanvasData(canvasId, userId, body);
    } catch (error) {
      // 如果canvas不存在，创建一个新的
      if (error.message?.includes('Canvas not found')) {
        await this.canvasService.createCanvasInternal(canvasId, userId, {
          name: 'Auto-created Canvas',
          data: body.data,
          thumbnail: body.thumbnail,
        });
      } else {
        throw error;
      }
    }

    return { id: canvasId };
  }

  /**
   * 更新Timeline资产的startTime
   * POST /canvas/:id/timeline/assets/starttime
   */
  @Post(':id/timeline/assets/starttime')
  async updateTimelineAssetStartTimes(
    @Request() req: any,
    @Param('id') canvasId: string,
    @Body() body: { assets: Array<{ id: string; startTime: number }> },
  ): Promise<{ success: boolean; updatedCount: number }> {
    const userId = req.user?.id;

    try {
      // 获取当前canvas数据
      const canvas = await this.canvasService.getCanvasById(canvasId, userId);

      if (!canvas || !canvas.data) {
        throw new Error('Canvas not found');
      }

      // 确保timeline结构存在
      const canvasData = canvas.data as any;
      if (!canvasData.timeline || !canvasData.timeline.tracks) {
        throw new Error('Timeline data not found');
      }

      let updatedCount = 0;

      // 更新每个资产的startTime
      for (const updateAsset of body.assets) {
        for (const track of canvasData.timeline.tracks) {
          const assetIndex = track.assets.findIndex(
            (asset: any) => asset.id === updateAsset.id,
          );
          if (assetIndex !== -1) {
            track.assets[assetIndex].startTime = updateAsset.startTime;
            updatedCount++;
            break;
          }
        }
      }

      // 更新timeline的lastUpdated
      canvasData.timeline.lastUpdated = new Date().toISOString();

      // 保存到数据库
      await this.canvasService.updateCanvasData(canvasId, userId, {
        data: canvasData,
        thumbnail: canvas.thumbnail,
      });

      console.log(
        `✅ Updated startTime for ${updatedCount} assets in canvas ${canvasId}`,
      );

      return { success: true, updatedCount };
    } catch (error) {
      console.error('❌ Error updating timeline asset startTimes:', error);
      throw error;
    }
  }

  @Post(':id/timeline/asset/:assetId/regenerate')
  async regenerateTimelineAsset(
    @Request() req: any,
    @Param('id') canvasId: string,
    @Param('assetId') assetId: string,
    @Body() body: { prompt?: string },
  ): Promise<{ success: boolean; asset: any; credits_consumed: number }> {
    const userId = req.user?.id;
    const canvas = await this.canvasService.getCanvasById(canvasId, userId);

    if (!canvas?.data?.timeline?.tracks) {
      throw new BadRequestException('Timeline data not found');
    }

    const canvasData = canvas.data as any;
    let targetTrack: any = null;
    let targetAsset: any = null;

    for (const track of canvasData.timeline.tracks) {
      const found = track.assets.find((asset: any) => asset.id === assetId);
      if (found) {
        targetTrack = track;
        targetAsset = found;
        break;
      }
    }

    if (!targetAsset || !targetTrack) {
      throw new BadRequestException(`Asset not found: ${assetId}`);
    }

    const now = this.updateAssetTimestamps(targetAsset);
    const prompt = this.buildRegeneratePrompt(targetAsset, body.prompt);
    targetAsset.content = targetAsset.content || {};
    targetAsset.metadata = targetAsset.metadata || {};
    targetAsset.content.description = prompt.slice(0, 160);
    targetAsset.metadata.regeneratedAt = now;
    targetAsset.metadata.regeneratePrompt = body.prompt || '';
    this.appendEditHistory(targetAsset, {
      action: 'local_regenerate_requested',
      source: 'nolanx_open_source_local',
      timestamp: now,
      prompt,
    });

    targetTrack.lastUpdated = now;
    canvasData.timeline.lastUpdated = now;
    await this.canvasService.updateCanvasData(canvasId, userId, {
      data: canvasData,
      thumbnail: canvas.thumbnail,
    });

    return { success: true, asset: targetAsset, credits_consumed: 0 };
  }

  @Get('/internal/:id')
  async getCanvasInternal(@Param('id') canvasId: string): Promise<CanvasResponseDto> {
    return this.canvasService.getCanvasByIdForInternal(canvasId);
  }

  @Put('/internal/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateCanvasInternal(
    @Param('id') canvasId: string,
    @Body() body: UpdateCanvasDataDto,
  ): Promise<void> {
    await this.canvasService.updateCanvasDataInternal(canvasId, body);
  }

  @Post('/internal')
  async createCanvasInternal(@Body() body: { canvas_id?: string; name?: string; user_id?: string }): Promise<CanvasResponseDto> {
    const canvas = await this.canvasService.createCanvas(body.user_id || 'local-dev-user', {
      canvas_id: body.canvas_id,
      name: body.name || 'Untitled Scene',
    } as any);
    return canvas;
  }

  @Get('/internal')
  async listCanvasesInternal(@Query('user_id') userId?: string): Promise<CanvasListResponseDto> {
    return this.canvasService.getUserCanvases(userId || 'local-dev-user', {
      page: '1',
      limit: '100',
      sort: 'updated_at',
      order: 'desc',
    } as any);
  }

  @Delete('/internal/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCanvasInternal(@Param('id') canvasId: string): Promise<void> {
    const canvas = await this.canvasService.getCanvasByIdForInternal(canvasId);
    await this.canvasService.deleteCanvas(canvasId, canvas.id ? canvas['user_id'] || 'local-dev-user' : 'local-dev-user');
  }

  @Put('/internal/:id/name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async renameCanvasInternal(@Param('id') canvasId: string, @Body() body: { name: string }): Promise<void> {
    const canvas = await this.canvasService.getCanvasByIdForInternal(canvasId);
    await this.canvasService.renameCanvas(canvasId, canvas['user_id'] || 'local-dev-user', { name: body.name });
  }

  @Post('/internal/:id/timeline/asset')
  async addTimelineAssetInternal(
    @Param('id') canvasId: string,
    @Body() body: { assetType: string; assetData: any },
  ): Promise<{ success: boolean; canvas: CanvasResponseDto }> {
    const canvas = await this.canvasService.addTimelineAssetInternal(canvasId, body.assetType, body.assetData);
    return { success: true, canvas };
  }

  @Put('/internal/:id/timeline/asset/:assetId')
  async updateTimelineAssetInternal(
    @Param('id') canvasId: string,
    @Param('assetId') assetId: string,
    @Body() body: Record<string, any>,
  ): Promise<{ success: boolean; canvas: CanvasResponseDto }> {
    const canvas = await this.canvasService.updateTimelineAssetInternal(canvasId, assetId, body);
    return { success: true, canvas };
  }

  @Delete('/internal/:id/timeline/asset/:assetId')
  async deleteTimelineAssetInternal(
    @Param('id') canvasId: string,
    @Param('assetId') assetId: string,
  ): Promise<{ success: boolean; canvas: CanvasResponseDto }> {
    const canvas = await this.canvasService.deleteTimelineAssetInternal(canvasId, assetId);
    return { success: true, canvas };
  }

  /**
   * 健康检查
   * GET /canvas/health
   */
  @Get('health/check')
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
