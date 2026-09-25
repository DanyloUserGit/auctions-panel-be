import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit-log/audit.interceptor';
import { AppExceptionFilter } from './utils/http-exception.filter';
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
import { ScheduleModule } from '@nestjs/schedule';
import { MailModule } from './mail/mail.module';
import { ProfileModule } from './profile/profile.module';
import { NotificationModule } from './notification/notification.module';
import { TrainingModule } from './training/training.module';
import { SessionLoggerModule } from './session-logger/session-logger.module';
import { GlobalSettingsModule } from './global-settings/global-settings.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { ClientDbModule } from './client-db/client-db.module';
import { CalculationModule } from './calculation/calculation.module';
import { BalanceModule } from './balance/balance.module';
import { ProcessesModule } from './processes/processes.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { OrdersModule } from './orders/orders.module';
import { InStockModule } from './in-stock/in-stock.module';
import { WonCarsModule } from './won-cars/won-cars.module';
import { UserGroupsModule } from './user-groups/user-groups.module';
import { UploadsModule } from './uploads/uploads.module';
import { CrmClientsModule } from './crm-clients/crm-clients.module';
import { AccessRulesModule } from './access-rules/access-rules.module';
import { ClientsModule } from './clients/clients.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
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
    MailModule,
    ProfileModule,
    NotificationModule,
    TrainingModule,
    SessionLoggerModule,
    GlobalSettingsModule,
    AuditLogModule,
    ClientDbModule,
    CalculationModule,
    BalanceModule,
    ProcessesModule,
    AnalyticsModule,
    OrdersModule,
    InStockModule,
    WonCarsModule,
    UserGroupsModule,
    UploadsModule,
    CrmClientsModule,
    AccessRulesModule,
    ClientsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
