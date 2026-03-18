import { Module } from '@nestjs/common';
import { ExternalDbManager } from './client-db.service';

@Module({
  providers: [ExternalDbManager],
  exports: [ExternalDbManager]
})
export class ClientDbModule {}
