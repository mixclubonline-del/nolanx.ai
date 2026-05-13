import { IsArray, IsString, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 聊天消息DTO
 */
export class ChatMessageDto {
    @IsString()
    role: 'user' | 'assistant' | 'system'

    @IsString()
    content: string | any

    @IsOptional()
    tool_calls?: any;

    @IsOptional()
    tool_call_id?: string
}



/**
 * 聊天请求DTO
 */
export class ChatRequestDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ChatMessageDto)
    messages: ChatMessageDto[];

    @IsString()
    session_id: string;

    @IsOptional()
    @IsString()
    canvas_id?: string;

    @IsOptional()
    @IsString()
    preferred_language?: string;
}

/**
 * 创建消息DTO
 */
export class CreateMessageDto {
    @IsString()
    session_id: string;

    @IsOptional()
    @IsString()
    user_id?: string;

    @IsString()
    role: 'user' | 'assistant' | 'system';

    content: any;
}
