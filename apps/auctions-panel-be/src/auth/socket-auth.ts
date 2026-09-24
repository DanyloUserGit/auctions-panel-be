import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

const getCookie = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
};

// Та сама перевірка, що й у JwtStrategy: access_token з httpOnly cookie, підпис JWT_SECRET,
// користувач існує і не заблокований. userId, надісланий клієнтом, ніколи не використовується.
// Токен з handshake перевіряється один раз (під час з'єднання він може прострочитись),
// а блокування - при кожному виклику.
export const authenticateSocket = async (
  client: Socket,
  jwtService: JwtService,
  config: ConfigService,
  prisma: PrismaService
): Promise<string | null> => {
  let userId: string | undefined = client.data.userId;

  if (!userId) {
    const token = getCookie(client.handshake.headers.cookie, 'access_token');
    if (!token) return null;

    try {
      const payload = await jwtService.verifyAsync<{ id: string }>(token, {
        secret: config.getOrThrow<string>('JWT_SECRET'),
      });
      userId = payload.id;
    } catch {
      return null;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isBlocked: true },
  });

  if (!user || user.isBlocked) {
    client.data.userId = undefined;
    return null;
  }

  client.data.userId = user.id;
  return user.id;
};
