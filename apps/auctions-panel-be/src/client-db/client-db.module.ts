import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExternalDbManager } from './client-db.service';
import { CrmScopeService } from './crm-scope.service';

@Module({
  imports: [PrismaModule],
  providers: [ExternalDbManager, CrmScopeService],
  exports: [ExternalDbManager, CrmScopeService]
})
export class ClientDbModule {}
