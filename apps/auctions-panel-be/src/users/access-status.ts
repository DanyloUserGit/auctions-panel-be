import { AccessStatus, Roles } from '@prisma/client';

// Статуси доступу (ТЗ 12), з якими дозволено натискати кнопки покупки/ставки.
export const PURCHASE_STATUSES: AccessStatus[] = [AccessStatus.Purchase, AccessStatus.PurchaseSale, AccessStatus.PurchaseNoSales];

export const canPurchase = (user: { role: Roles; accessStatus: AccessStatus }) =>
  user.role === Roles.SuperAdmin || PURCHASE_STATUSES.includes(user.accessStatus);

export const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  ReadOnly: 'Тільки перегляд',
  Purchase: 'Дозволені покупки',
  PurchaseSale: 'Дозволені покупки + дозволені продажі',
  PurchaseNoSales: 'Дозволені покупки без доступу до продажів',
};
