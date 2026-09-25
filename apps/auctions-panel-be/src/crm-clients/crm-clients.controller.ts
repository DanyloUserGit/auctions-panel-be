import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { z } from 'zod';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { CrmClientsService } from './crm-clients.service';

const AssignmentSchema = z.object({
  clientName: z.string().trim().min(1),
  userIds: z.array(z.string().uuid()),
});

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin)
@Controller('crm-clients')
export class CrmClientsController {
  constructor(private readonly service: CrmClientsService) { }

  @Get()
  list() {
    return this.service.list();
  }

  @Audit('crm.clients.assign', 'Змінено відповідальних за клієнта «{body.clientName}»')
  @Put('assignment')
  setAssignment(@Body() body: unknown) {
    const { clientName, userIds } = AssignmentSchema.parse(body);
    return this.service.setAssignment(clientName, userIds);
  }
}
