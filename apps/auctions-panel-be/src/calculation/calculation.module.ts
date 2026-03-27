import { Module } from '@nestjs/common';
import { CalculationService } from './full_calculation.service';
import { ClientDbModule } from '../client-db/client-db.module';
import { CalculationController } from './calculation.controller';

@Module({
  imports: [ClientDbModule],
  providers: [CalculationService],
  controllers: [CalculationController]
})
export class CalculationModule { }
