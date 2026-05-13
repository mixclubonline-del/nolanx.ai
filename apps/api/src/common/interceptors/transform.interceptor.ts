import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/response.interface';
import { Request } from 'express';

@Injectable()
export class TransformInterceptor<T>
    implements NestInterceptor<T, ApiResponse<T>> {
    intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Observable<ApiResponse<T>> {
        const request = context.switchToHttp().getRequest<Request>();

        return next.handle().pipe(
            map(data => {
                // 如果返回的数据已经是标准格式，直接返回
                if (data?.code !== undefined) {
                    return {
                        ...data,
                        timestamp: new Date().toISOString(),
                    };
                }

                // 否则，将数据包装成标准格式
                return {
                    code: 200,
                    data,
                    message: 'success',
                    timestamp: new Date().toISOString(),
                };
            }),
        );
    }
} 