import { Controller, Get, Query, Headers } from '@nestjs/common';
import { ProcessesService } from './processes.service';

@Controller('processes')
export class ProcessesController {
    constructor(private readonly processesService: ProcessesService) { }

    @Get()
    async getProcesses(@Headers('x-db-name') dbName: string, @Query() query: any) {
        // dbName можна отримувати з заголовків (якщо у вас мультитенантність) або з auth токену
        return this.processesService.getProcesses(dbName, {
            clients: query.client ? query.client.split(',') : null,
            clientIds: query.client_id ? query.client_id.split(',') : null,
            showAll: query.client === 'ALL_KEY', // замініть на вашу константу
            open: query.open,
            asof: query.asof,
        });
    }
}