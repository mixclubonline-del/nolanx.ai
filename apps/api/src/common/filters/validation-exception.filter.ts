import { ExceptionFilter, Catch, ArgumentsHost, BadRequestException } from '@nestjs/common';
import { Response } from 'express';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
    catch(exception: BadRequestException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const status = exception.getStatus();

        // 获取验证错误信息
        const validationErrors = exception.getResponse() as any;
        response.status(status).json({
            code: status,
            message: 'Invalid parameters',
            errors: validationErrors,
            timestamp: new Date().toISOString(),
        });
    }
} 