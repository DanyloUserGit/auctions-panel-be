import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadsService } from '../uploads/uploads.service';
import { CarFiltersSchema, CarSchema, CreateCarSchema } from './dto/car.dto';
import { InStockService } from './in-stock.service';

@Controller('in-stock')
export class InStockController {
  constructor(
    private readonly inStockService: InStockService,
    private readonly uploads: UploadsService,
  ) { }

  @Get()
  getCars(@Req() req, @Query() query: unknown) {
    return this.inStockService.getInStockCars(req.user, CarFiltersSchema.parse(query));
  }

  @Get('brands')
  getBrands(@Req() req, @Query('q') q?: string) {
    return this.inStockService.getBrands(req.user, q);
  }

  @Get('brands/:brandId/models')
  getModels(@Req() req, @Param('brandId', ParseIntPipe) brandId: number, @Query('q') q?: string) {
    return this.inStockService.getModels(req.user, brandId, q);
  }

  // Завантаження фото; повертає шляхи в тому ж порядку. Порядок, видалення й заміна - через поле photos авто.
  @Post('photos')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadPhotos(@Req() req, @UploadedFiles() files: Express.Multer.File[]) {
    if (!this.inStockService.canView(req.user) || !(this.inStockService.canAdd(req.user))) {
      throw new ForbiddenException('Недостатньо прав для завантаження фото');
    }
    const urls: string[] = [];
    for (const file of files ?? []) {
      urls.push(await this.uploads.saveImage('in-stock', file));
    }
    return { urls };
  }

  @Get(':id')
  getCar(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.inStockService.getCar(req.user, id);
  }

  @Post()
  createCar(@Req() req, @Body() body: unknown) {
    return this.inStockService.createCar(req.user, CreateCarSchema.parse(body));
  }

  @Put(':id')
  updateCar(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.inStockService.updateCar(req.user, id, CarSchema.parse(body));
  }

  @Post(':id/sell')
  sellCar(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.inStockService.sellCar(req.user, id);
  }
}
