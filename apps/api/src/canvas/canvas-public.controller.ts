import {
    Controller,
    Get,
    Param,
    BadRequestException,
} from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { ChatService } from '../chat/chat.service';
import { CanvasResponseDto } from './dto/canvas.dto';

@Controller('canvas')
export class CanvasPublicController {
    constructor(
        private readonly canvasService: CanvasService,
        private readonly chatService: ChatService,
    ) {}

    /**
     * 获取分享的Canvas详情（公开接口，无需认证）
     * GET /canvas/share/:id
     */
    @Get('share/:id')
    async getSharedCanvas(
        @Param('id') canvasId: string,
    ): Promise<CanvasResponseDto> {
        try {
            return await this.canvasService.getSharedCanvasById(canvasId);
        } catch (error) {
            throw new BadRequestException('Canvas not found or not available for sharing');
        }
    }

    /**
     * 获取分享的聊天历史（公开接口，无需认证）
     * GET /canvas/share/session/msgs/:sessionId
     */
    @Get('share/session/msgs/:sessionId')
    async getSharedChatHistory(@Param('sessionId') sessionId: string): Promise<any[]> {
        try {
            return await this.chatService.getSharedChatHistory(sessionId);
        } catch (error) {
            throw new BadRequestException('Chat history not found or not available for sharing');
        }
    }
}
