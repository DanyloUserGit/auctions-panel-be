import { Injectable } from '@nestjs/common';

@Injectable()
export class BrowserWorkerService {
  getHello(): string {
    return 'Hello World!';
  }
}
