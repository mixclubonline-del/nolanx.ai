import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CustomLogger } from '../services/logger.service';
import { getRealClientIP } from '../utils/ip.utils';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
    private middlewareLogger: CustomLogger;
    private readonly maxStringLength = 600;
    private readonly maxArrayItems = 10;
    private readonly maxObjectKeys = 20;
    private readonly maxDepth = 4;

    // 定义不需要记录日志的路径列表
    private readonly skipLogPaths: string[] = [
        '/post-stats', // 跳过所有post-stats接口
        '/blog'
    ];

    constructor(private readonly logger: CustomLogger) {
        // 创建一个专用于中间件的logger实例
        this.middlewareLogger = this.logger.createLoggerWithContext('LoggerMiddleware');
    }

    /**
     * 检查是否应该跳过此路径的日志记录
     * @param url 请求URL
     * @returns 是否跳过日志记录
     */
    private shouldSkipLogging(url: string): boolean {
        return this.skipLogPaths.some(skipPath => url.startsWith(skipPath));
    }

    private hasVisibleContent(value: unknown): boolean {
        if (value == null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
        return true;
    }

    private sanitizeLogValue(value: unknown, depth = 0): unknown {
        if (value == null) return value;

        if (Buffer.isBuffer(value)) {
            return '[Buffer omitted]';
        }

        if (typeof value === 'string') {
            if (value.length <= this.maxStringLength) return value;
            return `${value.slice(0, this.maxStringLength)}... [truncated ${value.length - this.maxStringLength} chars]`;
        }

        if (typeof value !== 'object') {
            return value;
        }

        if (depth >= this.maxDepth) {
            return '[Max depth reached]';
        }

        if (Array.isArray(value)) {
            const sanitizedItems = value
                .slice(0, this.maxArrayItems)
                .map(item => this.sanitizeLogValue(item, depth + 1));

            if (value.length > this.maxArrayItems) {
                sanitizedItems.push(`[+${value.length - this.maxArrayItems} more items]`);
            }

            return sanitizedItems;
        }

        const entries = Object.entries(value as Record<string, unknown>);
        const sanitizedObject: Record<string, unknown> = {};

        for (const [key, nestedValue] of entries.slice(0, this.maxObjectKeys)) {
            sanitizedObject[key] = this.sanitizeLogValue(nestedValue, depth + 1);
        }

        if (entries.length > this.maxObjectKeys) {
            sanitizedObject.__truncatedKeys = entries.length - this.maxObjectKeys;
        }

        return sanitizedObject;
    }

    private formatJsonBlock(label: string, value: unknown): string | null {
        if (!this.hasVisibleContent(value)) {
            return null;
        }

        const formatted = JSON.stringify(this.sanitizeLogValue(value), null, 2);
        return `  ${label}:\n${formatted
            .split('\n')
            .map(line => `    ${line}`)
            .join('\n')}`;
    }

    private formatRequestLog(requestLog: {
        requestId: string;
        timestamp: string;
        method: string;
        url: string;
        ip: string;
        userAgent: string;
        body: unknown;
        query: unknown;
        params: unknown;
    }): string {
        const sections = [
            `[Request] ${requestLog.method} ${requestLog.url}`,
            `  requestId: ${requestLog.requestId}`,
            `  timestamp: ${requestLog.timestamp}`,
            `  ip: ${requestLog.ip}`,
            `  userAgent: ${requestLog.userAgent || '-'}`,
            this.formatJsonBlock('params', requestLog.params),
            this.formatJsonBlock('query', requestLog.query),
            this.formatJsonBlock('body', requestLog.body),
        ].filter(Boolean);

        return sections.join('\n');
    }

    private formatResponseLog(responseLog: {
        requestId: string;
        timestamp: string;
        method: string;
        url: string;
        statusCode: number;
        responseTime: string;
        headers: unknown;
    }): string {
        const sections = [
            `[Response] ${responseLog.statusCode} ${responseLog.method} ${responseLog.url} (${responseLog.responseTime})`,
            `  requestId: ${responseLog.requestId}`,
            `  timestamp: ${responseLog.timestamp}`,
            this.formatJsonBlock('headers', responseLog.headers),
        ].filter(Boolean);

        return sections.join('\n');
    }

    use(req: Request, res: Response, next: NextFunction) {
        const middlewareLogger = this.middlewareLogger;
        const requestId = uuidv4();
        req['requestId'] = requestId;
        const startTime = Date.now();

        // 检查是否应该跳过日志记录，如果是则直接继续处理请求
        if (this.shouldSkipLogging(req.originalUrl)) {
            next();
            return;
        }

        const requestLog = {
            requestId,
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.originalUrl,
            ip: getRealClientIP(req),
            userAgent: req.get('user-agent') || '',
            body: Buffer.isBuffer(req.body) ? 'Logger省略[Buffer]内容...' : req.body,
            query: req.query,
            params: req.params,
        };

        // 使用中间件专用logger记录请求
        middlewareLogger.log(this.formatRequestLog(requestLog));

        // 使用事件监听方式记录响应日志
        res.on('finish', () => {
            const responseTime = Date.now() - startTime;
            const responseLog = {
                requestId,
                timestamp: new Date().toISOString(),
                method: req.method,
                url: req.originalUrl,
                statusCode: res.statusCode,
                responseTime: `${responseTime}ms`,
                headers: res.getHeaders(),
            };
            middlewareLogger.log(this.formatResponseLog(responseLog));
        });

        next();
    }
}
