import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMeta } from './audit.decorator';
import { AuditLogService } from './audit-log.service';

const pick = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source);

// Підставляє значення з запиту/відповіді в текст запису журналу.
function render(template: string, scope: Record<string, unknown>) {
  return template.replace(/\{([\w.]+)\}/g, (_, path: string) => {
    const value = pick(scope, path);
    return value === undefined || value === null ? '—' : String(value);
  });
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      tap((result) => {
        const scope = { body: req.body, params: req.params, result };
        const targetUserId = meta.targetUserParam ? req.params?.[meta.targetUserParam] : undefined;
        this.auditLog
          .admin({
            action: meta.action,
            actor: req.user,
            targetUserId,
            message: render(meta.message, scope),
            details: { params: req.params, body: req.body },
            ip: req.ip,
          })
          .catch(() => undefined);
      }),
    );
  }
}
