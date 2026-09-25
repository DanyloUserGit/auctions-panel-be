import { Module } from '@nestjs/common';
import { WonCarsService } from './won-cars.service';
import { WonCarsController } from './won-cars.controller';
import { ClientDbModule } from '../client-db/client-db.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ClientDbModule, PrismaModule],
  exports: [WonCarsService],
  providers: [WonCarsService],
  controllers: [WonCarsController]
})
export class WonCarsModule {}
