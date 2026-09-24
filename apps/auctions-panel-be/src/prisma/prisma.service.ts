import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Опції передаються і як тип, щоб TypeScript теж знав, що password відсутній у результатах.
type PrismaServiceOptions = {
  adapter: PrismaPg;
  omit: { user: { password: true } };
};

@Injectable()
export class PrismaService extends PrismaClient<PrismaServiceOptions> implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      // Хеш пароля ніколи не повертається з БД (включно з вкладеними include).
      // Лише перевірка логіну явно запитує його через omit: { password: false }.
      omit: { user: { password: true } },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
