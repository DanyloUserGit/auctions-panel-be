import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: 'notifications',
})
export class NotificationGateway implements OnGatewayConnection {
    @WebSocketServer()
    server: Server;

    handleConnection(client: Socket) {
        const userId = client.handshake.query.userId as string;
        if (userId) {
            client.join(userId);
        }
    }

    sendToUser(userId: string, payload: any) {
        this.server.to(userId).emit('new_notification', payload);
    }
}