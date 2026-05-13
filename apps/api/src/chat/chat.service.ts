import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { StreamTaskService } from './services/stream-task.service';
import { VideoGateService } from './services/video-gate.service';
import { v4 as uuidv4 } from 'uuid';
import { Message } from 'src/canvas/type';
import * as http from 'node:http';
import * as https from 'node:https';
import { RequestVideoGateDto } from './dto/video-gate.dto';

export const PYTHON_AGENT_API = 'http://localhost:52178/api/chat';
const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);

    constructor(
        private readonly chatSessionService: ChatSessionService,
        private readonly chatMessageService: ChatMessageService,
        private readonly streamTaskService: StreamTaskService,
        private readonly videoGateService: VideoGateService,
        private readonly configService: ConfigService,
    ) {}

    private getPreferredLanguageFromModels(models: Record<string, any> | undefined | null): string {
        if (!models || typeof models !== 'object') {
            return '';
        }
        const runtimePreferences = (models as Record<string, any>).runtime_preferences;
        if (!runtimePreferences || typeof runtimePreferences !== 'object') {
            return '';
        }
        const value = runtimePreferences.preferred_language;
        return typeof value === 'string' ? value.trim() : '';
    }

    private withPreferredLanguageInModels(models: Record<string, any> | undefined | null, preferredLanguage: string): Record<string, any> {
        const base = models && typeof models === 'object' ? models : {};
        return {
            ...base,
            runtime_preferences: {
                ...(base.runtime_preferences && typeof base.runtime_preferences === 'object' ? base.runtime_preferences : {}),
                preferred_language: preferredLanguage,
            },
        };
    }

    /**
     * 创建聊天会话并启动聊天 - 用于Canvas创建时
     */
    async createSessionAndStartChat({
        user_id,
        canvas_id,
        preferred_language,
        messages,
    }: {
        user_id: string;
        canvas_id: string;
        preferred_language?: string;
        messages: Message[];
        system_prompt?: string;
    }): Promise<string> {
        const session_id = uuidv4();

        // 创建session
        await this.chatSessionService.createChatSession({
            user_id: user_id,
            canvas_id: canvas_id,
            session_id,
            title: messages.length ? messages[0].content : 'New session',
            agent_type: 'multi',
            models: preferred_language ? this.withPreferredLanguageInModels(undefined, preferred_language) : undefined,
        });

        // 启动聊天处理（异步，不等待完成）
        this.handleSendMsg(user_id, {
            messages,
            session_id,
            canvas_id,
            preferred_language,
        }).catch(error => {
            this.logger.error(`Error in createSessionAndStartChat for session ${session_id}:`, error);
        });

        return session_id;
    }

    /**
     * 处理聊天消息 - 对应Python中的handle_chat函数
     */
    async handleSendMsg(user_id: string, data: ChatRequestDto): Promise<void> {
        const {
            messages,
            session_id,
            canvas_id,
            preferred_language,
        } = data;

        try {
            let resolvedPreferredLanguage = preferred_language?.trim() || '';
            const existingSession = await this.chatSessionService.getChatSessionById(session_id);
            const existingModels = (existingSession?.models && typeof existingSession.models === 'object')
                ? existingSession.models
                : {};

            if (!resolvedPreferredLanguage) {
                resolvedPreferredLanguage = this.getPreferredLanguageFromModels(existingModels);
            } else if (this.getPreferredLanguageFromModels(existingModels) !== resolvedPreferredLanguage) {
                await this.chatSessionService.updateChatSession(session_id, {
                    models: this.withPreferredLanguageInModels(existingModels, resolvedPreferredLanguage),
                });
            }

            // 保存最新一条消息到数据库
            if (messages.length > 0) {
                const latestMessage = messages[messages.length - 1];
                await this.chatMessageService.createMessage(
                    session_id,
                    latestMessage.role,
                    latestMessage,
                    user_id,
                );
            }

            // 多轮对话“记忆”来源于完整 session history，而不是前端每次上报的 messages。
            // 前端可能只发最新一条消息，导致 Python 侧没有上下文，看起来“没有记忆”。
            const history = await this.chatMessageService.getChatHistory(session_id);
            const fullMessages: Message[] = (history || []).map((m: any) => {
                const content = m?.content;
                if (content && typeof content === 'object' && 'role' in content && 'content' in content) {
                    return content as Message;
                }
                return {
                    role: m?.role as any,
                    content,
                    tool_calls: (m as any)?.tool_calls,
                    tool_call_id: (m as any)?.tool_call_id,
                } as Message;
            });

            // 同一 session 只保留一个活跃 agent 请求，避免并发串话。
            this.streamTaskService.cancelStreamTask(session_id);

            const controller = new AbortController();
            const task = this.callAgentService({
                canvas_id,
                session_id,
                messages: fullMessages.length ? fullMessages : messages,
                user_id,
                preferred_language: resolvedPreferredLanguage || undefined,
            }, controller.signal).catch((err) => {
                console.error('agent call error: ', err);
            }).finally(() => {
                this.streamTaskService.removeStreamTask(session_id);
            }).then(() => undefined);

            this.streamTaskService.addStreamTask(session_id, task, controller);
        } catch (error) {
            this.logger.error(`Error handling chat for session ${session_id}:`, error);
        }
    }

    async proxyAgentRequest(payload: Record<string, unknown>): Promise<any> {
        return this.callAgentService(payload);
    }

    private getPythonCancelUrl(sessionId: string): URL {
        const agentUrl = new URL(PYTHON_AGENT_API);
        const pathPrefix = agentUrl.pathname.replace(/\/chat$/, '');
        agentUrl.pathname = `${pathPrefix}/cancel/${sessionId}`;
        agentUrl.search = '';
        return agentUrl;
    }

    private getPythonVideoGateUrl(sessionId: string): URL {
        const agentUrl = new URL(PYTHON_AGENT_API);
        const pathPrefix = agentUrl.pathname.replace(/\/chat$/, '');
        agentUrl.pathname = `${pathPrefix}/video-gate/${sessionId}/approve`;
        agentUrl.search = '';
        return agentUrl;
    }

    private async notifyPythonCancel(sessionId: string): Promise<boolean> {
        const url = this.getPythonCancelUrl(sessionId);
        const transport = url.protocol === 'https:' ? https : http;

        return await new Promise((resolve) => {
            const req = transport.request(
                {
                    protocol: url.protocol,
                    hostname: url.hostname,
                    port: url.port,
                    path: `${url.pathname}${url.search}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': 0,
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];

                    res.on('data', (chunk) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });

                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        if ((res.statusCode || 500) >= 400) {
                            this.logger.warn(`Python cancel failed for session ${sessionId}: ${res.statusCode} ${res.statusMessage || raw}`);
                            resolve(false);
                            return;
                        }

                        try {
                            const parsed = raw.trim() ? JSON.parse(raw) : {};
                            const status = String((parsed as any)?.status || '').toLowerCase();
                            resolve(status === 'cancelled' || status === 'not_found_or_done');
                        } catch {
                            resolve(true);
                        }
                    });
                },
            );

            req.setTimeout(5000, () => {
                this.logger.warn(`Python cancel timeout for session ${sessionId}`);
                req.destroy(new Error('Python cancel timed out'));
            });

            req.on('error', (error) => {
                this.logger.warn(`Python cancel request error for session ${sessionId}: ${error.message}`);
                resolve(false);
            });

            req.end();
        });
    }

    private async notifyPythonVideoGateApprove(sessionId: string, reason?: string): Promise<boolean> {
        const url = this.getPythonVideoGateUrl(sessionId);
        const transport = url.protocol === 'https:' ? https : http;
        const body = JSON.stringify({ reason: reason || 'generate_now' });

        return await new Promise((resolve) => {
            const req = transport.request(
                {
                    protocol: url.protocol,
                    hostname: url.hostname,
                    port: url.port,
                    path: `${url.pathname}${url.search}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];

                    res.on('data', (chunk) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });

                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        if ((res.statusCode || 500) >= 400) {
                            this.logger.warn(`Python video gate approve failed for session ${sessionId}: ${res.statusCode} ${res.statusMessage || raw}`);
                            resolve(false);
                            return;
                        }

                        try {
                            const parsed = raw.trim() ? JSON.parse(raw) : {};
                            resolve(Boolean((parsed as any)?.approved));
                        } catch {
                            resolve(true);
                        }
                    });
                },
            );

            req.setTimeout(3000, () => {
                req.destroy(new Error('Python video gate approve timed out'));
            });

            req.on('error', (error) => {
                this.logger.warn(`Python video gate approve request error for session ${sessionId}: ${error.message}`);
                resolve(false);
            });

            req.write(body);
            req.end();
        });
    }

    private getAgentTimeoutMs(): number {
        const configured = this.configService.get<string>('PYTHON_AGENT_TIMEOUT_MS');
        const parsed = configured ? Number.parseInt(configured, 10) : Number.NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_TIMEOUT_MS;
    }

    private async callAgentService(payload: {
        messages: Message[];
        session_id: string;
        canvas_id: string;
        user_id?: string;
        preferred_language?: string;
    } | Record<string, unknown>, signal?: AbortSignal) {
        const timeoutMs = this.getAgentTimeoutMs();
        const agentApi = this.configService.get<string>('PYTHON_AGENT_API') || PYTHON_AGENT_API;
        const url = new URL(agentApi);
        const requestBody = JSON.stringify(payload);
        const transport = url.protocol === 'https:' ? https : http;

        return await new Promise((resolve, reject) => {
            let settled = false;
            let abortListener: (() => void) | undefined;

            const finalize = (error?: Error, result?: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (signal && abortListener) {
                    signal.removeEventListener('abort', abortListener);
                }
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result);
            };

            const req = transport.request(
                {
                    protocol: url.protocol,
                    hostname: url.hostname,
                    port: url.port,
                    path: `${url.pathname}${url.search}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(requestBody),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];

                    res.on('data', (chunk) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });

                    res.on('end', () => {
                        const raw = Buffer.concat(chunks).toString('utf8');

                        if ((res.statusCode || 500) >= 400) {
                            finalize(new Error(`Python service error: ${res.statusCode} ${res.statusMessage || raw}`));
                            return;
                        }

                        if (!raw.trim()) {
                            finalize(undefined, {});
                            return;
                        }

                        try {
                            finalize(undefined, JSON.parse(raw));
                        } catch (error) {
                            finalize(new Error(`Python service returned non-JSON payload: ${(error as Error).message}`));
                        }
                    });
                },
            );

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`Python agent request timed out after ${timeoutMs}ms`));
            });

            req.on('error', (error) => {
                finalize(error instanceof Error ? error : new Error(String(error)));
            });

            abortListener = () => {
                req.destroy(new Error('Python agent request aborted'));
            };

            if (signal) {
                if (signal.aborted) {
                    abortListener();
                    return;
                }
                signal.addEventListener('abort', abortListener, { once: true });
            }

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * 取消聊天任务
     */
    async cancelChat(sessionId: string): Promise<boolean> {
        const cancelled = this.streamTaskService.cancelStreamTask(sessionId);
        const pythonCancelled = await this.notifyPythonCancel(sessionId);
        this.videoGateService.clear(sessionId);

        if (cancelled) {
            this.logger.log(`Cancelled chat for session: ${sessionId}`);
        }
        if (pythonCancelled && !cancelled) {
            this.logger.log(`Cancelled python chat task for session: ${sessionId}`);
        }
        return cancelled || pythonCancelled;
    }

    async requestVideoGate(sessionId: string, dto: RequestVideoGateDto): Promise<void> {
        this.videoGateService.upsertPending(sessionId, {
            batchIndex: dto.batch_index,
            totalBatches: dto.total_batches,
            clipCount: dto.clip_count,
            timeoutSeconds: dto.timeout_seconds || 180,
        });
    }

    getVideoGateState(sessionId: string) {
        return this.videoGateService.get(sessionId);
    }

    async approveVideoGate(sessionId: string, reason?: string): Promise<boolean> {
        const state = this.videoGateService.approve(sessionId);
        const pythonApproved = await this.notifyPythonVideoGateApprove(sessionId, reason);
        if (state) {
            return true;
        }
        return Boolean(pythonApproved);
    }

    /**
     * 获取聊天历史
     */
    async getChatHistory(sessionId: string): Promise<any[]> {
        return this.chatMessageService.getChatHistory(sessionId);
    }

    /**
     * 获取分享的聊天历史（公开接口，无需认证）
     */
    async getSharedChatHistory(sessionId: string): Promise<any[]> {
        return this.chatMessageService.getChatHistory(sessionId);
    }

    /**
     * 获取用户的聊天会话列表
     */
    async getUserSessions(userId: string): Promise<any[]> {
        return this.chatSessionService.getUserChatSessions(userId);
    }

    /**
     * 删除聊天会话
     */
    async deleteSession(sessionId: string): Promise<void> {
        // 先取消可能正在进行的任务
        this.streamTaskService.cancelStreamTask(sessionId);

        // 删除会话（消息会因为外键级联删除）
        await this.chatSessionService.deleteChatSession(sessionId);
    }

    /**
     * 获取活跃任务状态
     */
    getActiveTasksStatus(): {
        activeTaskCount: number;
        activeSessions: string[];
    } {
        return {
            activeTaskCount: this.streamTaskService.getActiveTaskCount(),
            activeSessions: this.streamTaskService.getActiveSessionIds(),
        };
    }

    /**
     * Fork会话 - 使用SQL批量复制,高效处理大量消息
     */
    async forkSession(userId: string, sourceSessionId: string): Promise<{ canvas_id: string; session_id: string }> {
        this.logger.log(`Forking session ${sourceSessionId} for user ${userId}`);

        const newCanvasId = uuidv4();
        const newSessionId = uuidv4();

        const sourceSession = await this.chatSessionService.getChatSessionById(sourceSessionId);
        if (!sourceSession) {
            throw new Error(`Source session not found: ${sourceSessionId}`);
        }

        const history = await this.chatMessageService.getChatHistory(sourceSessionId);

        await this.chatSessionService.createChatSession({
            session_id: newSessionId,
            canvas_id: newCanvasId,
            user_id: userId,
            title: sourceSession.title || 'Forked session',
            agent_type: sourceSession.agent_type || 'multi',
            system_prompt: sourceSession.system_prompt,
            models: sourceSession.models,
        });

        for (const message of history) {
            await this.chatMessageService.createMessage(
                newSessionId,
                (message.role as 'user' | 'assistant' | 'system') || 'assistant',
                message.content,
                userId,
            );
        }

        this.logger.log(`Successfully forked session ${sourceSessionId} to ${newSessionId} with canvas ${newCanvasId}`);

        return {
            canvas_id: newCanvasId,
            session_id: newSessionId,
        };
    }
}
