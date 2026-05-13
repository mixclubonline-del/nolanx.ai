import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
    CreateCanvasDto,
    UpdateCanvasDataDto,
    RenameCanvasDto,
    CanvasResponseDto,
    CanvasListItemDto,
    CanvasListResponseDto,
    CanvasQueryDto,
    CanvasStatsDto,
} from './dto/canvas.dto';
import { LocalStorageService } from '../local-storage/local-storage.service';

@Injectable()
export class CanvasService {
    constructor(private readonly localStorage: LocalStorageService) {}

    async createCanvas(userId: string, createCanvasDto: CreateCanvasDto): Promise<CanvasResponseDto> {
        const { canvas_id, name, messages } = createCanvasDto;
        const now = new Date().toISOString();
        const canvasName =
            name ||
            (messages?.[0]?.content ? String(messages[0].content).trim().slice(0, 120) : '') ||
            'Untitled Scene';

        const row = this.localStorage.upsert('canvases', {
            id: canvas_id || randomUUID(),
            user_id: userId,
            name: canvasName,
            data: {},
            thumbnail: null,
            created_at: now,
            updated_at: now,
        });

        return this.mapCanvas(row);
    }

    async getUserCanvases(userId: string, queryDto: CanvasQueryDto): Promise<CanvasListResponseDto> {
        const pageNum = Math.max(1, parseInt(queryDto.page || '1', 10) || 1);
        const limitNum = Math.max(1, parseInt(queryDto.limit || '20', 10) || 20);
        const search = (queryDto.search || '').trim().toLowerCase();
        const order = (queryDto.order || 'desc').toLowerCase();
        const sort = queryDto.sort || 'created_at';

        let canvases = this.localStorage.findMany('canvases', (canvas) => canvas.user_id === userId);
        if (search) {
            canvases = canvases.filter((canvas) => String(canvas.name || '').toLowerCase().includes(search));
        }

        canvases.sort((a, b) => {
            const left = String(a[sort] || '');
            const right = String(b[sort] || '');
            return order === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
        });

        const offset = (pageNum - 1) * limitNum;
        const page = canvases.slice(offset, offset + limitNum);
        const mapped: CanvasListItemDto[] = page.map((row) => ({
            id: row.id,
            name: row.name,
            thumbnail: row.thumbnail,
            data: row.data || {},
            created_at: row.created_at,
        }));

        return {
            canvases: mapped,
            total: canvases.length,
            page: pageNum,
            limit: limitNum,
        };
    }

    async getCanvasById(canvasId: string, userId: string): Promise<CanvasResponseDto> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas || canvas.user_id !== userId) {
            throw new NotFoundException('Canvas not found or access denied');
        }
        return this.mapCanvas(canvas);
    }

    async updateCanvasData(
        canvasId: string,
        userId: string,
        updateDataDto: UpdateCanvasDataDto,
    ): Promise<void> {
        await this.verifyCanvasOwnership(canvasId, userId);
        this.localStorage.update('canvases', canvasId, {
            data: updateDataDto.data || {},
            thumbnail: updateDataDto.thumbnail || null,
        });
    }

    async updateCanvasDataInternal(canvasId: string, updateDataDto: UpdateCanvasDataDto): Promise<void> {
        const updated = this.localStorage.update('canvases', canvasId, {
            data: updateDataDto.data || {},
            thumbnail: updateDataDto.thumbnail || null,
        });
        if (!updated) {
            throw new NotFoundException('Canvas not found');
        }
    }

    async createCanvasInternal(
        canvasId: string,
        userId: string,
        canvasData: { name: string; data?: any; thumbnail?: string },
    ): Promise<void> {
        this.localStorage.upsert('canvases', {
            id: canvasId,
            user_id: userId,
            name: canvasData.name || 'Auto-created Canvas',
            data: canvasData.data || {},
            thumbnail: canvasData.thumbnail || null,
        });
    }

    async getCanvasByIdInternal(canvasId: string): Promise<CanvasResponseDto | null> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        return canvas ? this.mapCanvas(canvas) : null;
    }

    async getCanvasByIdForInternal(canvasId: string): Promise<CanvasResponseDto> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas) {
            throw new NotFoundException('Canvas not found');
        }
        return this.mapCanvas(canvas);
    }

    async addTimelineAssetInternal(canvasId: string, assetType: string, assetData: any): Promise<CanvasResponseDto> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas) {
            throw new NotFoundException('Canvas not found');
        }

        const data = canvas.data && typeof canvas.data === 'object' ? canvas.data : {};
        const timeline = data.timeline && typeof data.timeline === 'object' ? data.timeline : {};
        const tracks = Array.isArray(timeline.tracks) ? [...timeline.tracks] : [];
        const now = new Date().toISOString();

        const trackId = assetType === 'video' ? 'video-track' : 'keyframe-track';
        let track = tracks.find((item: any) => item?.id === trackId);
        if (!track) {
            track = {
                id: trackId,
                type: assetType === 'video' ? 'video' : 'image',
                name: assetType === 'video' ? 'Video Track' : 'Keyframe Track',
                assets: [],
                createdAt: now,
                lastUpdated: now,
            };
            tracks.push(track);
        }

        const assets = Array.isArray(track.assets) ? [...track.assets] : [];
        assets.push(assetData);
        track.assets = assets;
        track.lastUpdated = now;

        this.localStorage.update('canvases', canvasId, {
            data: {
                ...data,
                timeline: {
                    ...timeline,
                    tracks,
                    lastUpdated: now,
                },
            },
        });
        return this.getCanvasByIdForInternal(canvasId);
    }

    async updateTimelineAssetInternal(canvasId: string, assetId: string, updates: Record<string, any>): Promise<CanvasResponseDto> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas) {
            throw new NotFoundException('Canvas not found');
        }

        const data = canvas.data && typeof canvas.data === 'object' ? canvas.data : {};
        const timeline = data.timeline && typeof data.timeline === 'object' ? data.timeline : {};
        const tracks = Array.isArray(timeline.tracks) ? [...timeline.tracks] : [];
        const now = new Date().toISOString();
        let found = false;

        for (const track of tracks) {
            if (!Array.isArray(track?.assets)) {
                continue;
            }
            const index = track.assets.findIndex((asset: any) => asset?.id === assetId);
            if (index === -1) {
                continue;
            }
            track.assets = [
                ...track.assets.slice(0, index),
                { ...track.assets[index], ...updates },
                ...track.assets.slice(index + 1),
            ];
            track.lastUpdated = now;
            found = true;
            break;
        }

        if (!found) {
            throw new NotFoundException('Asset not found');
        }

        this.localStorage.update('canvases', canvasId, {
            data: {
                ...data,
                timeline: {
                    ...timeline,
                    tracks,
                    lastUpdated: now,
                },
            },
        });
        return this.getCanvasByIdForInternal(canvasId);
    }

    async deleteTimelineAssetInternal(canvasId: string, assetId: string): Promise<CanvasResponseDto> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas) {
            throw new NotFoundException('Canvas not found');
        }

        const data = canvas.data && typeof canvas.data === 'object' ? canvas.data : {};
        const timeline = data.timeline && typeof data.timeline === 'object' ? data.timeline : {};
        const tracks = Array.isArray(timeline.tracks) ? [...timeline.tracks] : [];
        const now = new Date().toISOString();
        let removed = false;

        for (const track of tracks) {
            if (!Array.isArray(track?.assets)) {
                continue;
            }
            const nextAssets = track.assets.filter((asset: any) => asset?.id !== assetId);
            if (nextAssets.length !== track.assets.length) {
                track.assets = nextAssets;
                track.lastUpdated = now;
                removed = true;
                break;
            }
        }

        if (!removed) {
            throw new NotFoundException('Asset not found');
        }

        this.localStorage.update('canvases', canvasId, {
            data: {
                ...data,
                timeline: {
                    ...timeline,
                    tracks,
                    lastUpdated: now,
                },
            },
        });
        return this.getCanvasByIdForInternal(canvasId);
    }

    async renameCanvas(canvasId: string, userId: string, renameDto: RenameCanvasDto): Promise<void> {
        await this.verifyCanvasOwnership(canvasId, userId);
        this.localStorage.update('canvases', canvasId, { name: renameDto.name });
    }

    async deleteCanvas(canvasId: string, userId: string): Promise<boolean> {
        await this.verifyCanvasOwnership(canvasId, userId);
        return this.localStorage.delete('canvases', canvasId);
    }

    async getUserCanvasStats(userId: string): Promise<CanvasStatsDto> {
        const canvases = this.localStorage.findMany('canvases', (canvas) => canvas.user_id === userId);
        const recent = canvases
            .map((canvas) => canvas.updated_at || canvas.created_at)
            .filter(Boolean)
            .sort()
            .at(-1) || null;

        return {
            total_canvases: canvases.length,
            recent_activity: recent as any,
        };
    }

    async canvasExists(canvasId: string): Promise<boolean> {
        return Boolean(this.localStorage.findById('canvases', canvasId));
    }

    async getCanvasUserId(canvasId: string): Promise<string | null> {
        return this.localStorage.findById('canvases', canvasId)?.user_id || null;
    }

    async getSharedCanvasById(canvasId: string): Promise<CanvasResponseDto> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas) {
            throw new NotFoundException('Canvas not found');
        }
        return this.mapCanvas(canvas);
    }

    private async verifyCanvasOwnership(canvasId: string, userId: string): Promise<void> {
        const canvas = this.localStorage.findById('canvases', canvasId);
        if (!canvas || canvas.user_id !== userId) {
            throw new NotFoundException('Canvas not found or access denied');
        }
    }

    private mapCanvas(canvas: Record<string, any>): CanvasResponseDto {
        const sessions = this.localStorage
            .findMany('chat_sessions', (session) => session.canvas_id === canvas.id)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .map((session) => ({
                id: session.id,
                canvas_id: canvas.id,
                session_id: session.id,
                title: session.title || '',
                created_at: session.created_at,
                updated_at: session.updated_at || session.created_at,
            }));

        return {
            id: canvas.id,
            name: canvas.name,
            canvas_id: canvas.id,
            data: canvas.data || {},
            thumbnail: canvas.thumbnail,
            created_at: canvas.created_at,
            updated_at: canvas.updated_at || canvas.created_at,
            sessions,
        };
    }
}
