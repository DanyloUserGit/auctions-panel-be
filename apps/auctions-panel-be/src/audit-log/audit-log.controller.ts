import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { AuditFilterSchema } from './audit-filter.dto';
import { AuditLogService } from './audit-log.service';

// «Журнали: входи / дії адмінів» (ТЗ 4, 9; [?23]) - у «Всіх діях» окремими вкладками.
@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) { }

  @Get()
  list(@Query() query: unknown, @Req() req) {
    return this.auditLog.list(AuditFilterSchema.parse(query), req.user);
  }
}
