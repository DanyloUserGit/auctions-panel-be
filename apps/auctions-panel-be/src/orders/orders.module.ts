import { Module } from '@nestjs/common';
import { ClientDbModule } from '../client-db/client-db.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ClientDbModule],
  providers: [OrdersService],
  controllers: [OrdersController]
})
export class OrdersModule { }
