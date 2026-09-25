import { Module } from '@nestjs/common';
import { ClientDbModule } from '../client-db/client-db.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CrmClientsController } from './crm-clients.controller';
import { CrmClientsService } from './crm-clients.service';

@Module({
  imports: [ClientDbModule, PrismaModule],
  controllers: [CrmClientsController],
  providers: [CrmClientsService],
})
export class CrmClientsModule { }
