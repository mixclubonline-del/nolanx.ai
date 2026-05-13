import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RuntimeConfigController } from './runtime-config.controller';
import { RuntimeConfigService } from './runtime-config.service';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RuntimeConfigController],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
