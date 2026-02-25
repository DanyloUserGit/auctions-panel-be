import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { StringValue } from 'ms';
import { AuctionAuthModule } from './auction-auth/auction-auth.module';
import { AuctionGroupsModule } from './auction-groups/auction-groups.module';
import { AuctionsModule } from './auctions/auctions.module';
import { JwtAuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<StringValue>('JWT_EXPIRES_IN'),
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    AuctionsModule,
    AuctionGroupsModule,
    AuctionAuthModule,
    SessionsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
