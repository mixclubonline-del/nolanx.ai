import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CustomLogger } from '../services/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private filterLogger: CustomLogger;

  constructor(private readonly logger: CustomLogger) {
    // 创建一个专用于异常过滤器的logger实例
    this.filterLogger = this.logger.createLoggerWithContext(
      'HttpExceptionFilter',
    );
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.message : '服务器内部错误';

    const isThrottled = status === HttpStatus.TOO_MANY_REQUESTS;

    const errorResponse = {
      code: status,
      message,
      data: null,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // 限流错误不写日志，避免干扰正常日志
    if (!isThrottled) {
      this.filterLogger.error(
        `Error: ${message}`,
        exception instanceof Error ? exception.stack : '未知错误',
      );
    }

    response.status(status).json(errorResponse);
  }
}
