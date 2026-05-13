import { Module } from '@nestjs/common';
import { AuthVerifyController } from './auth-verify.controller';

@Module({
  controllers: [AuthVerifyController],
})
export class AuthModule {}
