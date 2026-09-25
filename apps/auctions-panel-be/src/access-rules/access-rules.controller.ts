import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { Audit } from '../audit-log/audit.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { AccessRuleSchema, AccessRulesService, RuleFilterSchema } from './access-rules.service';

@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin, Roles.Admin)
@Controller('access-rules')
export class AccessRulesController {
  constructor(private readonly rules: AccessRulesService) { }

  @Get()
  list(@Req() req, @Query() query: unknown) {
    return this.rules.list(req.user, RuleFilterSchema.parse(query));
  }

  @Audit('rules.level.add', 'Додано правило «{body.value}» ({body.kind}, {body.effect})')
  @Post()
  create(@Req() req, @Body() body: unknown) {
    return this.rules.create(req.user, AccessRuleSchema.parse(body));
  }

  @Audit('rules.level.remove', 'Видалено правило {params.id}')
  @Delete(':id')
  remove(@Req() req, @Param('id') id: string) {
    return this.rules.remove(req.user, id);
  }
}
