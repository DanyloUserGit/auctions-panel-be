import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError } from 'zod';

// Помилки валідації та відомі помилки Prisma - це помилки запиту, а не сервера:
// повертаємо 400/404/409 зі зрозумілим текстом замість 500 (ТЗ 11: створення працівника без 500).
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return super.catch(exception, host);

    const mapped = this.map(exception);
    if (!mapped) return super.catch(exception, host);

    const res = host.switchToHttp().getResponse<Response>();
    res.status(mapped.status).json({ statusCode: mapped.status, message: mapped.message });
  }

  private map(exception: unknown): { status: number; message: string | string[] } | null {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: exception.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: HttpStatus.CONFLICT, message: 'Запис з такими даними вже існує (наприклад, цей email уже використовується)' };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, message: 'Запис не знайдено' };
        case 'P2003':
          return { status: HttpStatus.CONFLICT, message: 'Запис пов’язаний з іншими даними й не може бути змінений чи видалений' };
      }
    }

    return null;
  }
}
