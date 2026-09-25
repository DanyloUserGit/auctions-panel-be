import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RuleEffect, RuleKind, Roles } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { managedGroupIdOf } from '../users/managed-group';

export const AccessRuleSchema = z
  .object({
    kind: z.nativeEnum(RuleKind),
    value: z.string().trim().min(1).max(500),
    effect: z.nativeEnum(RuleEffect).default(RuleEffect.Forbid),
    isBuyAction: z.boolean().default(false),
    auctionId: z.string().uuid().nullish(),
    userGroupId: z.string().uuid().nullish(),
    userId: z.string().uuid().nullish(),
  })
  .refine((r) => !(r.userGroupId && r.userId), { message: 'Правило діє або на групу, або на користувача' })
  .refine((r) => r.kind !== RuleKind.Route || (r.value !== '/' && r.value.replace(/\*/g, '').trim().length > 0), {
    message: 'Правило «/» або «*» заборонило б увесь сайт',
  });

export const RuleFilterSchema = z.object({
  auctionId: z.string().uuid().optional(),
  userGroupId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

type Actor = { id: string; role: Roles };

const include = {
  auction: { select: { id: true, title: true } },
  userGroup: { select: { id: true, name: true } },
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.AccessRuleInclude;

// Правила на рівнях глобально / група / користувач (ТЗ 8). SuperAdmin - будь-які;
// GA - для своєї групи та її учасників, якщо Super Admin увімкнув групі canGaManageRules.
@Injectable()
export class AccessRulesService {
  constructor(private readonly prisma: PrismaService) { }

  // Група, правилами якої може керувати GA (null - не може).
  private async gaGroup(actor: Actor) {
    const groupId = await managedGroupIdOf(this.prisma, actor.id);
    if (!groupId) return null;
    const group = await this.prisma.userGroup.findUnique({ where: { id: groupId }, select: { canGaManageRules: true } });
    return group?.canGaManageRules ? groupId : null;
  }

  private async assertCanManage(actor: Actor, rule: { userGroupId?: string | null; userId?: string | null }) {
    if (actor.role === Roles.SuperAdmin) return;
    const groupId = actor.role === Roles.Admin ? await this.gaGroup(actor) : null;
    if (!groupId) throw new ForbiddenException('Керувати правилами може Super Admin або GA з відповідним дозволом');

    if (rule.userGroupId === groupId) return;
    if (rule.userId) {
      const member = await this.prisma.user.count({ where: { id: rule.userId, userGroupId: groupId, role: Roles.User } });
      if (member) return;
    }
    throw new ForbiddenException('GA задає правила лише для своєї групи та її учасників');
  }

  async list(actor: Actor, filters: z.infer<typeof RuleFilterSchema>) {
    const and: Prisma.AccessRuleWhereInput[] = [];
    if (actor.role !== Roles.SuperAdmin) {
      const groupId = await managedGroupIdOf(this.prisma, actor.id);
      if (!groupId) return { canManage: false, rules: [] };
      and.push({ OR: [{ userGroupId: groupId }, { user: { userGroupId: groupId } }] });
    }
    if (filters.auctionId) and.push({ auctionId: filters.auctionId });
    if (filters.userGroupId) and.push({ userGroupId: filters.userGroupId });
    if (filters.userId) and.push({ userId: filters.userId });

    const rules = await this.prisma.accessRule.findMany({ where: { AND: and }, include, orderBy: { createdAt: 'desc' } });
    const canManage = actor.role === Roles.SuperAdmin || !!(await this.gaGroup(actor));
    return { canManage, rules };
  }

  async create(actor: Actor, data: z.infer<typeof AccessRuleSchema>) {
    if (actor.role !== Roles.SuperAdmin && !data.userGroupId && !data.userId) {
      throw new BadRequestException('Глобальні правила задає лише Super Admin');
    }
    await this.assertCanManage(actor, data);
    return this.prisma.accessRule.create({ data, include });
  }

  async remove(actor: Actor, id: string) {
    const rule = await this.prisma.accessRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Правило не знайдено');
    await this.assertCanManage(actor, rule);
    await this.prisma.accessRule.delete({ where: { id } });
    return { success: true };
  }
}
