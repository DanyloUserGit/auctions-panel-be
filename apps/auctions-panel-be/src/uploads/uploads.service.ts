import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export type UploadFolder = 'in-stock' | 'training';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const FILE_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

// Файли (фото авто, зображення навчання) зберігаються на сервері платформи, без зовнішніх сервісів
// (ТЗ 1: усе на одному сервері). Каталог - UPLOADS_DIR (за замовчуванням ./uploads).
// У базі зберігається шлях виду /api/uploads/<folder>/<file>.
@Injectable()
export class UploadsService {
  private get root() {
    return path.resolve(process.env.UPLOADS_DIR || 'uploads');
  }

  async saveImage(folder: UploadFolder, file: Express.Multer.File | undefined): Promise<string> {
    if (!file?.buffer) throw new BadRequestException('Файл не передано');
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Дозволені лише зображення JPG, PNG, WEBP або GIF');
    if (file.size > MAX_IMAGE_SIZE) throw new BadRequestException('Зображення завелике (максимум 15 МБ)');

    const name = `${randomUUID()}${ext}`;
    const dir = path.join(this.root, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), file.buffer);
    return `/api/uploads/${folder}/${name}`;
  }

  // Абсолютний шлях до збереженого файлу; лише імена, які генерує saveImage.
  resolve(folder: string, file: string): string {
    if (!['in-stock', 'training'].includes(folder) || !FILE_NAME.test(file)) {
      throw new NotFoundException();
    }
    return path.join(this.root, folder, file);
  }
}
