import { Module } from '@nestjs/common';
import { BrowserWorkerController } from './browser-worker.controller';
import { BrowserService } from './browser-worker.service';
import { WebrtcService } from '../webrtc/webrtc.service';

@Module({
  imports: [],
  controllers: [BrowserWorkerController],
  providers: [BrowserService, WebrtcService],
})
export class BrowserWorkerModule {}
