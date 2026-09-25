import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { UpdateGlobalSettingsSchema } from './dto/update-global-settings.dto';
import { GlobalSettingsService } from './global-settings.service';


@Controller('global-settings')
@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin)
export class GlobalSettingsController {
    constructor(private readonly globalSettingsService: GlobalSettingsService) { }

    // Прапорці, від яких залежить інтерфейс адміністраторів груп.
    @Get('features')
    @RolesDecorator(Roles.SuperAdmin, Roles.Admin)
    async getFeatures() {
        const { gaCanAssignGa } = await this.globalSettingsService.getSettings();
        return { gaCanAssignGa };
    }

    @Get()
    getSettings() {
        return this.globalSettingsService.getSettings();
    }

    @Audit('settings.global.update', 'Змінено глобальні налаштування')
    @Patch()
    updateSettings(@Body() body: unknown) {
        return this.globalSettingsService.updateSettings(UpdateGlobalSettingsSchema.parse(body));
    }
}