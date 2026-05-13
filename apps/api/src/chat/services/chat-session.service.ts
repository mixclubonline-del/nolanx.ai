import { Injectable } from '@nestjs/common';
import { CreateChatSessionDto, ChatSessionResponseDto } from '../dto/chat-session.dto';
import { LocalStorageService } from '../../local-storage/local-storage.service';

@Injectable()
export class ChatSessionService {
    constructor(private readonly localStorage: LocalStorageService) {}

    async createChatSession(data: CreateChatSessionDto): Promise<ChatSessionResponseDto> {
        const defaultModels = {
            text: {
                model: 'local',
                provider: 'local',
                parameters: {
                    temperature: 0.7,
                    max_tokens: 4096,
                },
            },
        };
        const mergedModels = {
            ...(data.models || defaultModels),
            ...(data.metadata?.preferred_language ? {
                runtime_preferences: {
                    preferred_language: data.metadata.preferred_language,
                },
            } : {}),
        };

        return this.localStorage.upsert('chat_sessions', {
            id: data.session_id,
            canvas_id: data.canvas_id,
            user_id: data.user_id,
            title: data.title || 'New session',
            models: mergedModels,
            system_prompt: data.system_prompt,
            agent_type: data.agent_type || 'multi',
        }) as ChatSessionResponseDto;
    }

    async getChatSessionById(sessionId: string): Promise<ChatSessionResponseDto | null> {
        return this.localStorage.findById('chat_sessions', sessionId) as ChatSessionResponseDto | null;
    }

    async updateChatSession(
        sessionId: string,
        updates: Partial<Omit<CreateChatSessionDto, 'session_id'>>,
    ): Promise<ChatSessionResponseDto> {
        const session = this.localStorage.update('chat_sessions', sessionId, updates);
        if (!session) {
            throw new Error(`Chat session not found: ${sessionId}`);
        }
        return session as ChatSessionResponseDto;
    }

    async getUserChatSessions(userId: string): Promise<ChatSessionResponseDto[]> {
        return this.localStorage
            .findMany('chat_sessions', (session) => session.user_id === userId)
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) as ChatSessionResponseDto[];
    }

    async deleteChatSession(sessionId: string): Promise<void> {
        this.localStorage.delete('chat_sessions', sessionId);
    }
}
