import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessRulesController } from './access-rules.controller';
import { AccessRulesService } from './access-rules.service';

@Module({
  imports: [PrismaModule],
  controllers: [AccessRulesController],
  providers: [AccessRulesService],
})
export class AccessRulesModule { }
