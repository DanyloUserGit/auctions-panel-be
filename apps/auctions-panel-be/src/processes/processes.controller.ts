import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { z } from 'zod';
import { Audit } from '../audit-log/audit.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { CrmScopeService } from '../client-db/crm-scope.service';
import { PROCESS_STAGES, ProcessesService } from './processes.service';

const StageSchema = z.object({
    field: z.enum(PROCESS_STAGES),
    date: z.string().date().nullable(),
});

@Controller('processes')
export class ProcessesController {
    constructor(
        private readonly processesService: ProcessesService,
        private readonly scope: CrmScopeService,
    ) { }

    @Get()
    async getProcesses(@Req() req, @Query() query: any) {
        const isOpenStr = query.open;
        const isOpen = isOpenStr === '1' || isOpenStr === 'true';

        const isShowAll = !query.client || query.client === 'ALL_KEY';

        const parseQueryParam = (param: any) => {
            if (!param) return null;
            return Array.isArray(param) ? param : String(param).split(',');
        };

        return this.processesService.getProcesses(await this.scope.clientNames(req.user), {
            clients: isShowAll ? null : parseQueryParam(query.client),
            clientIds: parseQueryParam(query.client_id),
            showAll: isShowAll,
            open: isOpen,
            asof: query.asof || null,
            search: query.search || '',
        });
    }

    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin, Roles.Admin)
    @Audit('crm.process.stage', 'Процес {params.id}: {body.field} = {body.date}')
    @Patch(':id')
    async updateStage(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
        const { field, date } = StageSchema.parse(body);
        return this.processesService.updateStage(await this.scope.clientNames(req.user), id, field, date);
    }
}
