import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UsersService } from '../users/users.service';

const cookieExtractor = (req: Request) => {
  return req?.cookies?.access_token || null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private usersService: UsersService
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload) {
    const user = await this.usersService.findOne(payload.id);

    if (!user) throw new UnauthorizedException();
    if (user.isBlocked) throw new UnauthorizedException('Користувача заблоковано');

    // Остання активність у панелі (ТЗ 4): не частіше ніж раз на хвилину, без очікування.
    this.usersService.touchActivity(user.id).catch(() => undefined);
    return user;
  }
}
