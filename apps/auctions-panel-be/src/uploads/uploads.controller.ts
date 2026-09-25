import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { Public } from '../decorators/public.decorator';
import { UploadsService } from './uploads.service';

// Зображення віддаються без авторизації (як і раніше з Cloudinary): ім'я файлу - випадковий UUID.
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) { }

  @Public()
  @Get(':folder/:file')
  get(@Param('folder') folder: string, @Param('file') file: string, @Res() res: Response) {
    const filePath = this.uploads.resolve(folder, file);
    if (!existsSync(filePath)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  }
}
