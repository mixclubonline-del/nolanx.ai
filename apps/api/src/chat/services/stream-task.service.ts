import { Injectable } from '@nestjs/common';

interface StreamTask {
    sessionId: string;
    promise: Promise<void>;
    controller?: AbortController;
}

@Injectable()
export class StreamTaskService {
    private streamTasks: Map<string, StreamTask> = new Map();

    /**
     * 添加流任务
     */
    addStreamTask(sessionId: string, promise: Promise<void>, controller?: AbortController): void {
        const task: StreamTask = {
            sessionId,
            promise,
            controller,
        };

        this.streamTasks.set(sessionId, task);
    }

    /**
     * 移除流任务
     */
    removeStreamTask(sessionId: string): boolean {
        return this.streamTasks.delete(sessionId);
    }

    /**
     * 取消流任务
     */
    cancelStreamTask(sessionId: string): boolean {
        const task = this.streamTasks.get(sessionId);
        if (!task) {
            return false;
        }

        // 如果有AbortController，使用它来取消任务
        if (task.controller) {
            task.controller.abort();
        }

        this.removeStreamTask(sessionId);
        return true;
    }

    /**
     * 获取活跃任务数量
     */
    getActiveTaskCount(): number {
        return this.streamTasks.size;
    }

    /**
     * 获取所有活跃的会话ID
     */
    getActiveSessionIds(): string[] {
        return Array.from(this.streamTasks.keys());
    }

    /**
     * 检查会话是否有活跃任务
     */
    hasActiveTask(sessionId: string): boolean {
        return this.streamTasks.has(sessionId);
    }

    /**
     * 清理所有任务
     */
    clearAllTasks(): void {
        // 取消所有活跃任务
        for (const [sessionId] of this.streamTasks) {
            this.cancelStreamTask(sessionId);
        }
        this.streamTasks.clear();
    }
} 