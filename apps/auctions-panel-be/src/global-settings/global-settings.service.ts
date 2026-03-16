import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateGlobalSettingsDto } from './dto/update-global-settings.dto';
import { GlobalSettingKey } from './constants/global-setting-keys.constant';
import { LogSeverity } from '@prisma/client';


export interface GlobalSettingsResponse {
    inactivityTimeout: number;
    globalSessionLimit: number;
    gaCanAssignGa: boolean;
    loggingPolicy: LogSeverity;
}

@Injectable()
export class GlobalSettingsService {
    constructor(private readonly prisma: PrismaService) { }

    async getSettings(): Promise<GlobalSettingsResponse> {
        const settings = await this.prisma.systemSetting.findMany();

        const result: GlobalSettingsResponse = {
            inactivityTimeout: 30,
            globalSessionLimit: 100,
            gaCanAssignGa: false,
            loggingPolicy: LogSeverity.Info,
        };

        settings.forEach((setting) => {
            switch (setting.key) {
                case GlobalSettingKey.INACTIVITY_TIMEOUT:
                    result.inactivityTimeout = Number(setting.value);
                    break;
                case GlobalSettingKey.GLOBAL_SESSION_LIMIT:
                    result.globalSessionLimit = Number(setting.value);
                    break;
                case GlobalSettingKey.GA_CAN_ASSIGN_GA:
                    result.gaCanAssignGa = setting.value === 'true';
                    break;
                case GlobalSettingKey.LOGGING_POLICY:
                    result.loggingPolicy = setting.value as LogSeverity;
                    break;
            }
        });

        return result;
    }

    async updateSettings(dto: UpdateGlobalSettingsDto): Promise<GlobalSettingsResponse> {
        const updates: any[] = [];

        if (dto.inactivityTimeout !== undefined) {
            updates.push(this.upsertSetting(GlobalSettingKey.INACTIVITY_TIMEOUT, dto.inactivityTimeout.toString()));
        }
        if (dto.globalSessionLimit !== undefined) {
            updates.push(this.upsertSetting(GlobalSettingKey.GLOBAL_SESSION_LIMIT, dto.globalSessionLimit.toString()));
        }
        if (dto.gaCanAssignGa !== undefined) {
            updates.push(this.upsertSetting(GlobalSettingKey.GA_CAN_ASSIGN_GA, dto.gaCanAssignGa.toString()));
        }
        if (dto.loggingPolicy !== undefined) {
            updates.push(this.upsertSetting(GlobalSettingKey.LOGGING_POLICY, dto.loggingPolicy));
        }

        if (updates.length > 0) {
            await this.prisma.$transaction(updates);
        }

        return this.getSettings();
    }

    private upsertSetting(key: string, value: string) {
        return this.prisma.systemSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
    }
}