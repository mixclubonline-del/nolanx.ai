import { Type } from 'class-transformer';
import { IsString, IsOptional, IsObject, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Message } from '../type';

/**
 * Canvas数据结构 (Excalidraw格式 + Timeline)
 */
export class CanvasDataDto {
    @IsArray()
    @IsOptional()
    elements?: any[];

    @IsObject()
    @IsOptional()
    appState?: any;

    @IsObject()
    @IsOptional()
    files?: any;

    @IsObject()
    @IsOptional()
    timeline?: any; // Timeline数据结构
}

/**
 * 创建Canvas请求DTO
 */
export class CreateCanvasDto {
    @IsString()
    @IsOptional()
    canvas_id?: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsArray({})
    @IsOptional()
    messages?: Message[];
}

/**
 * 更新Canvas数据请求DTO
 */
export class UpdateCanvasDataDto {
    @IsObject()
    @ValidateNested()
    @Type(() => CanvasDataDto)
    data: CanvasDataDto;

    @IsString()
    @IsOptional()
    thumbnail?: string;
}

/**
 * 重命名Canvas请求DTO
 */
export class RenameCanvasDto {
    @IsString()
    @IsNotEmpty()
    name: string;
}



/**
 * Chat Session简化信息DTO
 */
export class CanvasSessionDto {
    id: string;
    canvas_id: string;
    session_id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

/**
 * Canvas响应DTO
 */
export class CanvasResponseDto {
    id: string;
    name: string;
    canvas_id: string;
    data?: CanvasDataDto;
    thumbnail?: string;
    created_at: string;
    updated_at: string;
    sessions: CanvasSessionDto[];
}

/**
 * Canvas列表项DTO
 */
export class CanvasListItemDto {
    id: string;
    name: string;
    thumbnail?: string;
    data?: any;
    created_at: Date;
}

/**
 * Canvas列表响应DTO
 */
export class CanvasListResponseDto {
    canvases: CanvasListItemDto[];
    total: number;
    page?: number;
    limit?: number;
}

/**
 * Canvas统计信息DTO
 */
export class CanvasStatsDto {
    total_canvases: number;
    recent_activity: Date;
}

/**
 * Canvas查询参数DTO
 */
export class CanvasQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    sort?: 'created_at' | 'name';

    @IsOptional()
    @IsString()
    order?: 'asc' | 'desc';

    @IsOptional()
    @IsString()
    page?: string;

    @IsOptional()
    @IsString()
    limit?: string;
}
