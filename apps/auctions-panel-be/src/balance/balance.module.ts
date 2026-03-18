import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';
import { ClientDbModule } from '../client-db/client-db.module';

@Module({
  imports:[ClientDbModule],
  providers: [BalanceService],
  controllers: [BalanceController]
})
export class BalanceModule {}
