import { Controller } from '@nestjs/common';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}
}
