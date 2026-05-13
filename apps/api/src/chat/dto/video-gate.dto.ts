import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RequestVideoGateDto {
    @ApiProperty({ description: '批次序号，从 1 开始', example: 1 })
    @IsInt()
    @Min(1)
    batch_index: number;

    @ApiProperty({ description: '总批次数', example: 3 })
    @IsInt()
    @Min(1)
    total_batches: number;

    @ApiProperty({ description: '当前批次剪辑数量', example: 4 })
    @IsInt()
    @Min(1)
    clip_count: number;

    @ApiProperty({ description: '等待秒数', example: 180, required: false })
    @IsInt()
    @Min(1)
    @IsOptional()
    timeout_seconds?: number;
}

export class ApproveVideoGateDto {
    @ApiProperty({ description: '可选说明', required: false, example: 'generate_now' })
    @IsString()
    @IsOptional()
    @IsNotEmpty()
    reason?: string;
}
