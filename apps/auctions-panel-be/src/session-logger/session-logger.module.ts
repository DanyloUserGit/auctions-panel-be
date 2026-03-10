import { Module } from '@nestjs/common';
import { SessionLoggerService } from './session-logger.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionDispatcherService } from './session-dispatcher.service';
import { SessionLoggerController } from './session-logger.controller';
import { SessionDispatcherController } from './session-dispatcher.controller';

@Module({
  imports: [PrismaModule],
  providers: [SessionLoggerService, SessionDispatcherService],
  controllers: [SessionLoggerController, SessionDispatcherController],
  exports: [SessionDispatcherService, SessionLoggerService]
})
export class SessionLoggerModule { }
