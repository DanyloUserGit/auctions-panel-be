import { Module } from '@nestjs/common';
import { BrowserWorkerController } from './browser-worker.controller';
import { BrowserWorkerService } from './browser-worker.service';

@Module({
  imports: [],
  controllers: [BrowserWorkerController],
  providers: [BrowserWorkerService],
})
export class BrowserWorkerModule {}
