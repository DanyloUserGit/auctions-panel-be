import { Module } from '@nestjs/common';
import { ClientDbModule } from '../client-db/client-db.module';
import { InStockController } from './in-stock.controller';
import { InStockService } from './in-stock.service';
import { ExternalDbManager } from '../client-db/client-db.service';

@Module({
  imports: [ClientDbModule],
  controllers: [InStockController],
  providers: [InStockService, ExternalDbManager]
})
export class InStockModule { }
