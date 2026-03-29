import { Module } from '@nestjs/common';
import { WonCarsService } from './won-cars.service';
import { WonCarsController } from './won-cars.controller';
import { ClientDbModule } from '../client-db/client-db.module';

@Module({
  imports:[ClientDbModule],
  providers: [WonCarsService],
  controllers: [WonCarsController]
})
export class WonCarsModule {}
