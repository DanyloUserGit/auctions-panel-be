import { Module } from '@nestjs/common';
import { ClientDbModule } from '../client-db/client-db.module';
import { ExternalDbManager } from '../client-db/client-db.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [ClientDbModule],
  providers: [AnalyticsService, ExternalDbManager],
  controllers: [AnalyticsController]
})
export class AnalyticsModule { }
