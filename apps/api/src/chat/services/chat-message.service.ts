import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatMessageResponseDto } from '../dto/chat-session.dto';
import { LocalStorageService } from '../../local-storage/local-storage.service';

@Injectable()
export class ChatMessageService {
    constructor(private readonly localStorage: LocalStorageService) {}

    async createMessage(
        sessionId: string,
        role: 'user' | 'assistant' | 'system',
        content: any,
        userId?: string,
    ): Promise<ChatMessageResponseDto> {
        return this.localStorage.upsert('chat_messages', {
            id: randomUUID(),
            session_id: sessionId,
            role,
            content,
            user_id: userId,
        }) as ChatMessageResponseDto;
    }

    async getChatHistory(sessionId: string): Promise<ChatMessageResponseDto[]> {
        return this.localStorage
            .findMany('chat_messages', (message) => message.session_id === sessionId)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) as ChatMessageResponseDto[];
    }

    async getLatestMessage(sessionId: string): Promise<ChatMessageResponseDto | null> {
        return (await this.getChatHistory(sessionId)).at(-1) || null;
    }

    async deleteSessionMessages(sessionId: string): Promise<void> {
        for (const message of this.localStorage.findMany('chat_messages', (row) => row.session_id === sessionId)) {
            this.localStorage.delete('chat_messages', message.id);
        }
    }
}
