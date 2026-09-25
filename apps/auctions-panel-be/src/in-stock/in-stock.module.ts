import { Module } from '@nestjs/common';
import { ClientDbModule } from '../client-db/client-db.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadsModule } from '../uploads/uploads.module';
import { WonCarsModule } from '../won-cars/won-cars.module';
import { InStockController } from './in-stock.controller';
import { InStockService } from './in-stock.service';

@Module({
  imports: [ClientDbModule, PrismaModule, UploadsModule, WonCarsModule],
  controllers: [InStockController],
  providers: [InStockService]
})
export class InStockModule { }
