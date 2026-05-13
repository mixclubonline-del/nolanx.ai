import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { LoggerModule } from './common/services/logger.module';
import { EnvValidatorService } from './common/services/env-validator.service';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';
import { LocalStorageModule } from './local-storage/local-storage.module';
import { ChatModule } from './chat/chat.module';
import { CanvasModule } from './canvas/canvas.module';
import { AuthModule } from './agent-auth/auth.module';
import { RuntimeConfigModule } from './runtime-config/runtime-config.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggerModule,
    LocalStorageModule,
    RuntimeConfigModule,
    ChatModule,
    CanvasModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    EnvValidatorService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: ValidationExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly envValidator: EnvValidatorService) {
    const validation = this.envValidator.validateEnvironment();
    if (!validation.isValid) {
      console.error('Environment validation failed:', validation.errors);
      process.exit(1);
    }

    if (validation.warnings.length > 0) {
      console.warn('Environment validation warnings:', validation.warnings);
    }
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
