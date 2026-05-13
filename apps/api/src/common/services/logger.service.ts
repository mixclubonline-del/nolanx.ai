import { Injectable, LoggerService } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';

@Injectable()
export class CustomLogger implements LoggerService {
    private context: string = 'Application';

    constructor(
        @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger
    ) {}

    /**
     * 创建一个新的自定义日志实例，拥有独立的上下文
     * @param context 新实例的上下文
     * @returns 新的CustomLogger实例
     */
    createLoggerWithContext(context: string): CustomLogger {
        const newLogger = new CustomLogger(this.logger);
        newLogger.setContext(context);
        return newLogger;
    }

    setContext(context: string) {
        this.context = context;
    }

    getContext(): string {
        return this.context;
    }

    log(message: string) {
        this.logger.info(message, { context: this.context });
    }

    error(message: string, trace?: any) {
        this.logger.error(message, {
            context: this.context,
            trace: trace ?
                (typeof trace === 'string' ? trace : JSON.stringify(trace))
                : undefined
        });
    }

    warn(message: string) {
        this.logger.warn(message, { context: this.context });
    }

    debug(message: string) {
        this.logger.debug(message, { context: this.context });
    }

    verbose(message: string) {
        this.logger.verbose(message, { context: this.context });
    }
}