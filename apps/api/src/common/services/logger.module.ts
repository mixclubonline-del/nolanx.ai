import { Module, Global } from '@nestjs/common';
import { CustomLogger } from './logger.service';
import { WinstonModule } from 'nest-winston';
import { loggerConfig } from '../config/logger.config';

@Global()
@Module({
  imports: [WinstonModule.forRoot(loggerConfig)],
  providers: [CustomLogger],
  exports: [CustomLogger],
})
export class LoggerModule {}
