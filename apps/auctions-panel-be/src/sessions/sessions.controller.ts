import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SessionGateway } from './session.gateway';

@Controller()
export class SessionsController {
  constructor(private readonly sessionGateway: SessionGateway) {}

  @EventPattern('webrtc_signal_to_client')
  handleSignalFromWorker(@Payload() data: { sessionId: string; signalData: any }) {
    
    // ЗМІНЕНО: відправляємо в кімнату sessionId замість clientId
    this.sessionGateway.server
      .to(data.sessionId) 
      .emit('webrtc_signal_from_worker', data.signalData);
      
    console.log(`Відправлено сигнал від Worker-а до клієнтів у сесії ${data.sessionId}`);
  }
}