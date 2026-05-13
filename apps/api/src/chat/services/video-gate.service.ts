import { Injectable } from '@nestjs/common';

export type VideoGateStatus = 'idle' | 'pending' | 'approved' | 'expired';

export interface VideoGateState {
    status: VideoGateStatus;
    sessionId: string;
    batchIndex: number;
    totalBatches: number;
    clipCount: number;
    timeoutSeconds: number;
    requestedAt: string;
    approvedAt?: string;
    expiresAt?: string;
}

@Injectable()
export class VideoGateService {
    private readonly states = new Map<string, VideoGateState>();

    upsertPending(sessionId: string, payload: Omit<VideoGateState, 'sessionId' | 'status' | 'requestedAt'>): VideoGateState {
        const next: VideoGateState = {
            sessionId,
            status: 'pending',
            requestedAt: new Date().toISOString(),
            ...payload,
        };
        this.states.set(sessionId, next);
        return next;
    }

    approve(sessionId: string): VideoGateState | null {
        const current = this.states.get(sessionId);
        if (!current) {
            return null;
        }

        const next: VideoGateState = {
            ...current,
            status: 'approved',
            approvedAt: new Date().toISOString(),
        };
        this.states.set(sessionId, next);
        return next;
    }

    expire(sessionId: string): VideoGateState | null {
        const current = this.states.get(sessionId);
        if (!current) {
            return null;
        }

        const next: VideoGateState = {
            ...current,
            status: 'expired',
            expiresAt: new Date().toISOString(),
        };
        this.states.set(sessionId, next);
        return next;
    }

    get(sessionId: string): VideoGateState | null {
        return this.states.get(sessionId) ?? null;
    }

    clear(sessionId: string): void {
        this.states.delete(sessionId);
    }
}
