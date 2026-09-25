import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export type AuditMeta = { action: string; message: string; targetUserParam?: string };

// Записати успішний виклик у журнал дій адміністраторів (ТЗ 9: аудит змін налаштувань і доступів).
// У message можна підставляти {body.x}, {params.x}, {result.x}.
// targetUserParam - параметр маршруту з ID користувача, якого стосується дія.
export const Audit = (action: string, message: string, targetUserParam?: string) =>
  SetMetadata(AUDIT_KEY, { action, message, targetUserParam } satisfies AuditMeta);
