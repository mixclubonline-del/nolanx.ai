import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRequestDto, CreateMessageDto } from './dto/chat-request.dto';
import { ApproveVideoGateDto, RequestVideoGateDto } from './dto/video-gate.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtGuard } from '../common/guards/jwt.guard';

@Controller('chat')
export class ChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly chatSessionService: ChatSessionService,
        private readonly chatMessageService: ChatMessageService
    ) {}

    /**
     * 处理聊天请求
     */
    @Post('proxy')
    async handleProxyChat(@Body() payload: any): Promise<any> {
        return this.chatService.proxyAgentRequest(payload);
    }

    /**
     * 创建新的聊天会话
     */
    @Post('/sessions')
    @UseGuards(JwtGuard)
    async createSession(
        @CurrentUser() user: any,
        @Body() createSessionRequest: { canvas_id: string; preferred_language?: string; }
    ): Promise<{ session_id: string }> {
        const sessionId = await this.chatService.createSessionAndStartChat({
            user_id: user.id,
            canvas_id: createSessionRequest.canvas_id,
            preferred_language: createSessionRequest.preferred_language,
            messages: [], // 空消息数组，只创建session
        });

        return {
            session_id: sessionId,
        };
    }

    /**
     * Fork会话 - 复制会话和canvas到新用户
     */
    @Post('/sessions/:sessionId/fork')
    @UseGuards(JwtGuard)
    async forkSession(
        @CurrentUser() user: any,
        @Param('sessionId') sessionId: string,
    ): Promise<{ canvas_id: string; session_id: string }> {
        return this.chatService.forkSession(user.id, sessionId);
    }

    /**
     * 处理聊天请求
     */
    @Post('/send')
    @UseGuards(JwtGuard)
    async handleSendMsg(
        @CurrentUser() user: any,
        @Body() chatRequest: ChatRequestDto
    ): Promise<any> {
        return this.chatService.handleSendMsg(user.id, chatRequest);
    }

    @Get('session/:sessionId')
    async getChatSessionById(@Param('sessionId') sessionId: string) {
        return this.chatSessionService.getChatSessionById(sessionId);
    }

    /**
     * 创建聊天消息 - 用于Python服务调用
     */
    @Post('messages')
    async createMessage(@Body() createMessageDto: CreateMessageDto) {
        return this.chatMessageService.createMessage(
            createMessageDto.session_id,
            createMessageDto.role,
            createMessageDto.content,
            createMessageDto.user_id
        );
    }

    /**
     * 获取聊天历史
     */
    @Get('session/msgs/:sessionId')
    async getChatHistory(@Param('sessionId') sessionId: string): Promise<any[]> {
        return this.chatService.getChatHistory(sessionId);
    }

    /**
     * 取消聊天任务
     */
    @Post('session/:sessionId/cancel')
    async cancelChat(@Param('sessionId') sessionId: string): Promise<{ cancelled: boolean }> {
        const cancelled = await this.chatService.cancelChat(sessionId);
        return { cancelled };
    }

    @Post('session/:sessionId/video-gate/approve')
    @UseGuards(JwtGuard)
    async approveVideoGate(
        @Param('sessionId') sessionId: string,
        @Body() body: ApproveVideoGateDto,
    ): Promise<{ approved: boolean }> {
        const approved = await this.chatService.approveVideoGate(sessionId, body.reason);
        return { approved };
    }

    @Get('session/:sessionId/video-gate')
    @UseGuards(JwtGuard)
    async getPublicVideoGateState(@Param('sessionId') sessionId: string): Promise<{ state: any | null }> {
        const state = this.chatService.getVideoGateState(sessionId);
        return { state };
    }

    @Post('internal/session/:sessionId/video-gate/request')
    async requestVideoGate(
        @Param('sessionId') sessionId: string,
        @Body() body: RequestVideoGateDto,
    ): Promise<{ success: boolean }> {
        await this.chatService.requestVideoGate(sessionId, body);
        return { success: true };
    }

    @Get('internal/session/:sessionId/video-gate')
    async getVideoGateState(@Param('sessionId') sessionId: string): Promise<{ state: any | null }> {
        const state = this.chatService.getVideoGateState(sessionId);
        return { state };
    }

    /**
     * 兼容旧前端路径
     */
    @Post('cancel/:sessionId')
    async cancelChatLegacy(@Param('sessionId') sessionId: string): Promise<{ cancelled: boolean }> {
        const cancelled = await this.chatService.cancelChat(sessionId);
        return { cancelled };
    }

    /**
     * 删除聊天会话
     */
    @Delete('session/:sessionId')
    async deleteSession(@Param('sessionId') sessionId: string): Promise<{ message: string }> {
        await this.chatService.deleteSession(sessionId);
        return { message: 'Session deleted successfully' };
    }

    /**
 * 获取用户的聊天会话列表
 */
    @Get('sessions')
    async getUserSessions(@Query('userId') userId: string): Promise<any[]> {
        return this.chatService.getUserSessions(userId);
    }

    /**
     * 获取活跃任务状态
     */
    @Get('status/active-tasks')
    getActiveTasksStatus(): {
        activeTaskCount: number;
        activeSessions: string[];
    } {
        return this.chatService.getActiveTasksStatus();
    }
} 
