import { Roles } from '@prisma/client';

// Поля акаунта аукціону для SuperAdmin (без password).
export const SAFE_AUTH_SELECT = {
  id: true,
  title: true,
  email: true,
  auctionId: true,
} as const;

// Для всіх інших ролей: лише назва - логін (email) і пароль акаунта бачить тільки SuperAdmin.
export const PUBLIC_AUTH_SELECT = {
  id: true,
  title: true,
  auctionId: true,
} as const;

export const accountSelectFor = (role: Roles) =>
  role === Roles.SuperAdmin ? SAFE_AUTH_SELECT : PUBLIC_AUTH_SELECT;
