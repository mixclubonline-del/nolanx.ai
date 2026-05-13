import { IsString, IsOptional, IsUUID, IsObject } from 'class-validator';

/**
 * 创建聊天会话DTO
 */
export class CreateChatSessionDto {
    @IsUUID()
    session_id: string;

    @IsOptional()
    @IsUUID()
    canvas_id?: string;

    @IsOptional()
    @IsUUID()
    user_id?: string;

    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsObject()
    models?: Record<string, any>;

    @IsOptional()
    @IsString()
    system_prompt?: string;

    @IsOptional()
    @IsString()
    agent_type?: 'single' | 'multi';

    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

/**
 * 聊天会话响应DTO
 */
export class ChatSessionResponseDto {
    id: string;
    user_id?: string;
    canvas_id?: string;
    title?: string;
    models?: Record<string, any>;
    system_prompt?: string;
    agent_type?: 'single' | 'multi';
    metadata?: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

/**
 * 聊天消息响应DTO
 */
export class ChatMessageResponseDto {
    id: string;
    session_id: string;
    role: string;
    content: any;
    created_at: Date;
} 
