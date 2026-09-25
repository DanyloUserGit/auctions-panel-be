import { Injectable } from '@nestjs/common';
import { RuleEffect, RuleKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canPurchase } from '../users/access-status';

export type ClientRules = {
  forbiddenRoutes: string[];
  forbiddenSelectors: string[];
  // Список дозволених сторінок аукціону: якщо не порожній, переходи поза ним блокуються.
  allowedRoutes: string[];
};

type Candidate = { kind: RuleKind; value: string; effect: RuleEffect; isBuyAction: boolean; level: number };

// Рівні правил: 0 - аукціон і глобальні, 1 - група користувачів, 2 - користувач (найвищий пріоритет).
const LEVEL = { base: 0, group: 1, user: 2 } as const;

// Правила контролю дій для конкретного користувача в конкретному аукціоні (ТЗ 8, 12).
// Застосовуються воркером до сторінки (вкладки) саме цього користувача, тож у спільній сесії
// в кожного свої заборони.
@Injectable()
export class SessionRulesService {
  constructor(private readonly prisma: PrismaService) { }

  async forUser(userId: string, auctionId: string): Promise<ClientRules> {
    const [user, auction] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, accessStatus: true, userGroupId: true, managedGroup: { select: { id: true } } },
      }),
      this.prisma.auction.findUnique({
        where: { id: auctionId },
        select: {
          forbiddenRoutes: { select: { path: true } },
          forbiddenSelectors: { select: { selector: true, isBuyAction: true } },
          allowedRoutes: { select: { path: true } },
        },
      }),
    ]);
    if (!user || !auction) return { forbiddenRoutes: [], forbiddenSelectors: [], allowedRoutes: [] };

    const groupId = user.managedGroup?.id ?? user.userGroupId;
    const extra = await this.prisma.accessRule.findMany({
      where: {
        AND: [
          { OR: [{ auctionId: null }, { auctionId }] },
          {
            OR: [
              { userId: null, userGroupId: null },
              ...(groupId ? [{ userGroupId: groupId, userId: null }] : []),
              { userId },
            ],
          },
        ],
      },
    });

    const candidates: Candidate[] = [
      ...auction.forbiddenRoutes.map((r) => ({ kind: RuleKind.Route, value: r.path, effect: RuleEffect.Forbid, isBuyAction: false, level: LEVEL.base })),
      ...auction.forbiddenSelectors.map((s) => ({ kind: RuleKind.Selector, value: s.selector, effect: RuleEffect.Forbid, isBuyAction: s.isBuyAction, level: LEVEL.base })),
      ...extra.map((r) => ({
        kind: r.kind,
        value: r.value,
        effect: r.effect,
        isBuyAction: r.isBuyAction,
        level: r.userId ? LEVEL.user : r.userGroupId ? LEVEL.group : LEVEL.base,
      })),
    ];

    // Для кожного правила діє найконкретніший рівень (користувач > група > глобально/аукціон);
    // на одному рівні заборона сильніша за дозвіл.
    const decisions = new Map<string, Candidate>();
    for (const c of candidates) {
      const key = `${c.kind}:${c.value.trim()}`;
      const current = decisions.get(key);
      if (!current || c.level > current.level || (c.level === current.level && c.effect === RuleEffect.Forbid)) {
        decisions.set(key, c);
      }
    }

    const allowPurchase = canPurchase(user);
    const forbidden = [...decisions.values()].filter((d) => d.effect === RuleEffect.Forbid);
    return {
      forbiddenRoutes: forbidden.filter((d) => d.kind === RuleKind.Route).map((d) => d.value),
      forbiddenSelectors: forbidden
        .filter((d) => d.kind === RuleKind.Selector && !(d.isBuyAction && allowPurchase))
        .map((d) => d.value),
      allowedRoutes: auction.allowedRoutes.map((r) => r.path),
    };
  }
}
