import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientStage, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CrmScopeService, type CrmUser } from '../client-db/crm-scope.service';
import { PrismaService } from '../prisma/prisma.service';

export const ClientSchema = z.object({
  fullName: z.string().trim().min(2, { message: 'Вкажіть ПІБ' }).max(200),
  phone: z.string().trim().max(50).nullish(),
  city: z.string().trim().max(100).nullish(),
  lookingFor: z.string().max(2000).nullish(),
  stage: z.nativeEnum(ClientStage).default(ClientStage.New),
  comments: z.string().max(5000).nullish(),
});

export const ClientFilterSchema = z.object({
  search: z.string().trim().optional(),
  stage: z.nativeEnum(ClientStage).optional(),
});

const include = { owner: { select: { id: true, firstName: true, lastName: true } } } satisfies Prisma.ClientInclude;

// Клієнти (ТЗ 14): персональний облік замовників. User - свої, GA - групи, SA - усі.
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
  ) { }

  private async where(user: CrmUser): Promise<Prisma.ClientWhereInput> {
    const owners = await this.scope.ownerIds(user);
    return owners === null ? {} : { ownerId: { in: owners } };
  }

  async list(user: CrmUser, filters: z.infer<typeof ClientFilterSchema>) {
    const text = filters.search ? { contains: filters.search, mode: 'insensitive' as const } : undefined;
    return this.prisma.client.findMany({
      where: {
        AND: [
          await this.where(user),
          filters.stage ? { stage: filters.stage } : {},
          text ? { OR: [{ fullName: text }, { phone: text }, { city: text }, { lookingFor: text }] } : {},
        ],
      },
      include,
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async findVisible(user: CrmUser, id: string) {
    const client = await this.prisma.client.findFirst({ where: { AND: [{ id }, await this.where(user)] } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    return client;
  }

  create(user: CrmUser, data: z.infer<typeof ClientSchema>) {
    return this.prisma.client.create({ data: { ...data, ownerId: user.id }, include });
  }

  async update(user: CrmUser, id: string, data: Partial<z.infer<typeof ClientSchema>>) {
    await this.findVisible(user, id);
    return this.prisma.client.update({ where: { id }, data, include });
  }

  async remove(user: CrmUser, id: string) {
    await this.findVisible(user, id);
    await this.prisma.client.delete({ where: { id } });
    return { success: true };
  }
}
