import { Module, forwardRef } from '@nestjs/common';
import { CanvasController } from './canvas.controller';
import { CanvasPublicController } from './canvas-public.controller';
import { CanvasInternalController } from './canvas-internal.controller';
import { CanvasService } from './canvas.service';
import { ChatModule } from '../chat/chat.module';
import { LocalStorageModule } from '../local-storage/local-storage.module';

@Module({
    imports: [
        forwardRef(() => ChatModule), // 使用forwardRef避免循环依赖
        LocalStorageModule,
    ],
    controllers: [CanvasController, CanvasPublicController, CanvasInternalController],
    providers: [CanvasService],
    exports: [CanvasService],
})
export class CanvasModule {}
