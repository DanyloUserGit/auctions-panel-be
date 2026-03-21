import { Module } from '@nestjs/common';
import { ProcessesService } from './processes.service';
import { ProcessesController } from './processes.controller';
import { ClientDbModule } from '../client-db/client-db.module';

@Module({
  imports: [ClientDbModule],
  providers: [ProcessesService],
  controllers: [ProcessesController]
})
export class ProcessesModule { }
