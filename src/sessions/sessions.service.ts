import { Inject, Injectable } from '@nestjs/common';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SessionsService {
  constructor(
    @Inject('WORKER_SERVICE') private rabbitClient: ClientProxy,
    private prisma: PrismaService,
  ) { }

  async createAndStartSession(auctionId: string, authId: string, userId: string) {
    const session = await this.prisma.session.create({
      data: {
        auctionId,
        auctionAuthId: authId,
        maxConnections: 1,
        activeConnections: 0,
        isActive: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 4),
        users: { connect: { id: userId } },
      },
    });

    this.rabbitClient.emit('start_browser_session', {
      sessionId: session.id,
      auctionId,
      authId,
    });

    return session;
  }
}
