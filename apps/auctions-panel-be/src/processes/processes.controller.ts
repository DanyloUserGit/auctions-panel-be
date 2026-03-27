import { Controller, Get, Query, Headers } from '@nestjs/common';
import { ProcessesService } from './processes.service';

@Controller('processes')
export class ProcessesController {
    constructor(private readonly processesService: ProcessesService) { }
    @Get()
    async getProcesses(
        @Headers('x-db-name') dbName: string,
        @Query() query: any
    ) {
        const isOpenStr = query.open;
        const isOpen = isOpenStr === '1' || isOpenStr === 'true';

        const isShowAll = !query.client || query.client === 'ALL_KEY';

        const parseQueryParam = (param: any) => {
            if (!param) return null;
            return Array.isArray(param) ? param : String(param).split(',');
        };

        return this.processesService.getProcesses(dbName, {
            clients: isShowAll ? null : parseQueryParam(query.client),
            clientIds: parseQueryParam(query.client_id),
            showAll: isShowAll,
            open: isOpen,
            asof: query.asof || null,
            search: query.search || '',
        });
    }
}