import { Module } from '@nestjs/common';
import { SessionLoggerService } from './session-logger.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionDispatcherService } from './session-dispatcher.service';

@Module({
  imports:[PrismaModule],
  providers: [SessionLoggerService, SessionDispatcherService],
  exports: [SessionDispatcherService, SessionLoggerService]
})
export class SessionLoggerModule {}
