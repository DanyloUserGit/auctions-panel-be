import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { UpdateGlobalSettingsDto } from './dto/update-global-settings.dto';
import { GlobalSettingsService } from './global-settings.service';


@Controller('global-settings')
@UseGuards(RolesGuard)
@RolesDecorator(Roles.SuperAdmin)
export class GlobalSettingsController {
    constructor(private readonly globalSettingsService: GlobalSettingsService) { }

    @Get()
    getSettings() {
        return this.globalSettingsService.getSettings();
    }

    @Patch()
    updateSettings(@Body() updateGlobalSettingsDto: UpdateGlobalSettingsDto) {
        return this.globalSettingsService.updateSettings(updateGlobalSettingsDto);
    }
}