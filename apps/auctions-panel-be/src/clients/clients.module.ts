import { Module } from '@nestjs/common';
import { ClientDbModule } from '../client-db/client-db.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [PrismaModule, ClientDbModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule { }
