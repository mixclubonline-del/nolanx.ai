import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { StreamTaskService } from './services/stream-task.service';
import { VideoGateService } from './services/video-gate.service';
import { LocalStorageModule } from '../local-storage/local-storage.module';

@Module({
    imports: [
        LocalStorageModule,
        ConfigModule,
    ],
    controllers: [ChatController],
    providers: [
        ChatService,
        ChatSessionService,
        ChatMessageService,
        StreamTaskService,
        VideoGateService,
    ],
    exports: [
        ChatService,
        ChatSessionService,
        ChatMessageService,
        StreamTaskService,
        VideoGateService,
    ],
})
export class ChatModule {}
