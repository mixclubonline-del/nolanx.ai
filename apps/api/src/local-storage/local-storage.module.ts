import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class LocalStorageModule {}
