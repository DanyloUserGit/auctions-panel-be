import { corsOrigins } from '../utils/cors';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { authenticateSocket } from '../auth/socket-auth';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
    cors: {
        origin: corsOrigins(),
        credentials: true,
    },
    namespace: 'notifications',
})
export class NotificationGateway implements OnGatewayConnection {
    @WebSocketServer()
    server!: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly config: ConfigService,
        private readonly prisma: PrismaService
    ) { }

    // Кімната завжди визначається автентифікованим користувачем, а не userId від клієнта.
    async handleConnection(client: Socket) {
        const userId = await authenticateSocket(client, this.jwtService, this.config, this.prisma);
        if (!userId) {
            client.emit('error', { message: 'Unauthorized' });
            client.disconnect();
            return;
        }
        await client.join(userId);
    }

    sendToUser(userId: string, payload: any) {
        this.server.to(userId).emit('new_notification', payload);
    }
}
