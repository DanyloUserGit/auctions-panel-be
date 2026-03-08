import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SessionGateway } from './session.gateway';

@Controller()
export class SessionsController {
  constructor(private readonly sessionGateway: SessionGateway) {}

@EventPattern('webrtc_signal_to_client')
  handleSignalFromWorker(@Payload() data: { sessionId: string; clientId: string; signalData: any }) {
    this.sessionGateway.server
      .to(data.clientId) 
      .emit('webrtc_signal_from_worker', data.signalData);
  }
}
