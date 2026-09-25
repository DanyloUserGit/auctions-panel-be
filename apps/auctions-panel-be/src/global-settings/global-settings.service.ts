import { Injectable } from '@nestjs/common';
import { LogSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSettingKey } from './constants/global-setting-keys.constant';
import { UpdateGlobalSettingsDto } from './dto/update-global-settings.dto';

export interface GlobalSettingsResponse {
    inactivityTimeout: number;
    globalSessionLimit: number;
    sessionMaxConnections: number;
    // Скільки днів зберігати завершені сесії та їхні журнали; 0 - зберігати завжди.
    sessionRetentionDays: number;
    // Трансляція (ТЗ 7.6): кадрів за секунду, якість JPEG-кадрів (1-100), бітрейт відео (кбіт/с).
    streamFps: number;
    streamQuality: number;
    streamBitrateKbps: number;
    gaCanAssignGa: boolean;
    loggingPolicy: LogSeverity;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsResponse = {
    inactivityTimeout: 30,
    globalSessionLimit: 100,
    sessionMaxConnections: 5,
    sessionRetentionDays: 365,
    streamFps: 15,
    streamQuality: 90,
    streamBitrateKbps: 4000,
    gaCanAssignGa: false,
    loggingPolicy: LogSeverity.Info,
};

const KEY_BY_FIELD: Record<keyof GlobalSettingsResponse, GlobalSettingKey> = {
    inactivityTimeout: GlobalSettingKey.INACTIVITY_TIMEOUT,
    globalSessionLimit: GlobalSettingKey.GLOBAL_SESSION_LIMIT,
    sessionMaxConnections: GlobalSettingKey.SESSION_MAX_CONNECTIONS,
    sessionRetentionDays: GlobalSettingKey.SESSION_RETENTION_DAYS,
    streamFps: GlobalSettingKey.STREAM_FPS,
    streamQuality: GlobalSettingKey.STREAM_QUALITY,
    streamBitrateKbps: GlobalSettingKey.STREAM_BITRATE_KBPS,
    gaCanAssignGa: GlobalSettingKey.GA_CAN_ASSIGN_GA,
    loggingPolicy: GlobalSettingKey.LOGGING_POLICY,
};

@Injectable()
export class GlobalSettingsService {
    constructor(private readonly prisma: PrismaService) { }

    async getSettings(): Promise<GlobalSettingsResponse> {
        const settings = await this.prisma.systemSetting.findMany();
        const byKey = new Map(settings.map((s) => [s.key, s.value]));
        const result: GlobalSettingsResponse = { ...DEFAULT_GLOBAL_SETTINGS };

        for (const [field, key] of Object.entries(KEY_BY_FIELD) as [keyof GlobalSettingsResponse, GlobalSettingKey][]) {
            const raw = byKey.get(key);
            if (raw === undefined) continue;
            const current = DEFAULT_GLOBAL_SETTINGS[field];
            (result as any)[field] =
                typeof current === 'number' ? Number(raw) : typeof current === 'boolean' ? raw === 'true' : raw;
        }
        return result;
    }

    async updateSettings(dto: UpdateGlobalSettingsDto): Promise<GlobalSettingsResponse> {
        const updates = (Object.entries(dto) as [keyof GlobalSettingsResponse, unknown][])
            .filter(([field, value]) => value !== undefined && KEY_BY_FIELD[field])
            .map(([field, value]) => {
                const key = KEY_BY_FIELD[field];
                return this.prisma.systemSetting.upsert({
                    where: { key },
                    update: { value: String(value) },
                    create: { key, value: String(value) },
                });
            });

        if (updates.length > 0) {
            await this.prisma.$transaction(updates);
        }

        return this.getSettings();
    }
}
