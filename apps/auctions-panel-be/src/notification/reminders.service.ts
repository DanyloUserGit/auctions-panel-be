import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

export const ReminderSchema = z.object({
  title: z.string().trim().min(1, { message: 'Вкажіть, що саме завершується (лот, авто, аукціон)' }).max(300),
  url: z.string().trim().max(1000).optional(),
  endsAt: z.coerce.date(),
});

const DEFAULT_REMIND_BEFORE_SECONDS = 3600;

// Нагадування про завершення аукціону: користувач сам задає, за скільки часу нагадати
// (налаштування сповіщення AUCTION_ENDED), і додає лоти, про які нагадати (ТЗ 15).
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) { }

  private async remindBeforeSeconds(userId: string) {
    const setting = await this.prisma.userNotificationSetting.findFirst({
      where: { userId, notificationType: { name: 'AUCTION_ENDED' } },
      select: { value: true },
    });
    return setting?.value || DEFAULT_REMIND_BEFORE_SECONDS;
  }

  list(userId: string) {
    return this.prisma.auctionReminder.findMany({ where: { userId }, orderBy: { endsAt: 'asc' } });
  }

  async create(userId: string, data: z.infer<typeof ReminderSchema>) {
    if (data.endsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Час завершення має бути в майбутньому');
    }
    await this.notifications.initializeDefaultSettings(userId);
    const before = await this.remindBeforeSeconds(userId);
    const remindAt = new Date(Math.max(Date.now(), data.endsAt.getTime() - before * 1000));
    return this.prisma.auctionReminder.create({ data: { ...data, userId, remindAt } });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.auctionReminder.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Нагадування не знайдено');
    return { success: true };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDue() {
    const due = await this.prisma.auctionReminder.findMany({ where: { sentAt: null, remindAt: { lte: new Date() } } });
    for (const reminder of due) {
      try {
        const time = reminder.endsAt.toLocaleString('uk-UA', { timeZone: process.env.TZ || 'Europe/Kyiv' });
        await this.notifications.notify(reminder.userId, 'AUCTION_ENDED', {
          subject: `Скоро завершення: ${reminder.title}`,
          body: `«${reminder.title}» завершується ${time}.${reminder.url ? ` ${reminder.url}` : ''}`,
        });
        await this.prisma.auctionReminder.update({ where: { id: reminder.id }, data: { sentAt: new Date() } });
      } catch (error) {
        this.logger.error(`Не вдалося надіслати нагадування ${reminder.id}`, error as Error);
      }
    }
  }
}
