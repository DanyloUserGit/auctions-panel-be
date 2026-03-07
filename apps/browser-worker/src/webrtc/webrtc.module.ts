import { Module } from '@nestjs/common';

import { BrowserWorkerModule } from '../browser-worker.module';
import { WebrtcService } from './webrtc.service';

@Module({
  imports: [BrowserWorkerModule],
  providers: [WebrtcService],
})
export class WebrtcModule { }
