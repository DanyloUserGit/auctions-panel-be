import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { NotificationChannel } from '@prisma/client';
import { Public } from '../decorators/public.decorator';
import { NotificationService } from './notification.service';

class UpdateSettingsDto {
    @ApiProperty({ description: 'ID типу сповіщення', example: '123e4567-e89b-12d3-a456-426614174000' })
    typeId!: string;

    @ApiProperty({ description: 'Чи увімкнено сповіщення', required: false, example: true })
    isEnabled?: boolean;

    @ApiProperty({ description: 'Канали отримання сповіщень', enum: NotificationChannel, isArray: true, required: false, example: [NotificationChannel.InApp, NotificationChannel.Email] })
    channels?: NotificationChannel[];

    @ApiProperty({ description: 'Користувацьке значення (напр. за скільки секунд до завершення аукціону нагадати)', required: false, example: 3600 })
    value?: number;
}

class SetGroupRequirementDto {
    @ApiProperty({ description: 'ID типу сповіщення', example: '123e4567-e89b-12d3-a456-426614174000' })
    typeId!: string;

    @ApiProperty({ description: 'Чи є сповіщення обов\'язковим', example: true })
    isMandatory!: boolean;
}

@Controller('notifications')
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get('settings')
    async getMySettings(@Req() req) {
        return this.notificationService.getUserSettings(req.user.id);
    }

    @Get('my-groups')
    @ApiOperation({ summary: 'Отримати список груп користувачів, де поточний користувач є адміністратором' })
    async getMyGroups(@Req() req) {
        return this.notificationService.getMyAdminGroups(req.user.id);
    }

    @Public()
    @ApiOperation({ summary: 'Заповнити базу початковими типами сповіщень (Seed)' })
    @ApiResponse({ status: 201, description: 'Типи сповіщень успішно додані/оновлені.' })
    @Post('seed')
    async seedTypes() {
        return this.notificationService.seedNotificationTypes();
    }

    @Patch('settings')
    @ApiOperation({ summary: 'Оновити налаштування конкретного сповіщення для користувача' })
    @ApiBody({ type: UpdateSettingsDto })
    @ApiResponse({ status: 200, description: 'Налаштування успішно оновлено.' })
    @ApiResponse({ status: 400, description: 'Помилка валідації або спроба вимкнути обов\'язкове сповіщення.' })
    async updateMySettings(
        @Req() req,
        @Body() body: UpdateSettingsDto
    ) {
        return this.notificationService.updateSettings(req.user.id, body.typeId, {
            isEnabled: body.isEnabled,
            channels: body.channels,
            value: body.value
        });
    }
    @Get()
    @ApiOperation({ summary: 'Отримати список In-App сповіщень користувача з пагінацією' })
    @ApiQuery({ name: 'page', required: false, type: String, description: 'Номер сторінки (за замовчуванням: 1)' })
    @ApiQuery({ name: 'limit', required: false, type: String, description: 'Кількість записів на сторінці (за замовчуванням: 20)' })
    @ApiResponse({ status: 200, description: 'Список сповіщень отримано.' })
    async getNotifications(
        @Req() req,
        @Query('page') page: string,
        @Query('limit') limit: string
    ) {
        return this.notificationService.getNotifications(req.user.id, Number(page) || 1, Number(limit) || 20);
    }

    @Patch(':id/read')
    @ApiOperation({ summary: 'Помітити сповіщення як прочитане' })
    @ApiParam({ name: 'id', required: true, description: 'ID сповіщення' })
    @ApiResponse({ status: 200, description: 'Сповіщення помічено як прочитане.' })
    @ApiResponse({ status: 403, description: 'Немає доступу до цього сповіщення.' })
    async markAsRead(@Req() req, @Param('id') id: string) {
        return this.notificationService.markAsRead(req.user.id, id);
    }

    @Get('group/:groupId/requirements')
    @ApiOperation({ summary: 'Отримати поточні обов\'язкові налаштування групи (Тільки для Адмінів групи)' })
    @ApiParam({ name: 'groupId', required: true, description: 'ID групи користувачів (UserGroup)' })
    @ApiResponse({ status: 200, description: 'Список типів сповіщень зі статусом isMandatory.' })
    @ApiResponse({ status: 403, description: 'Користувач не є адміністратором групи.' })
    async getGroupRequirements(@Req() req, @Param('groupId') groupId: string) {
        return this.notificationService.getGroupRequirements(req.user.id, groupId);
    }

    @Patch('group/:groupId/requirements')
    @ApiOperation({ summary: 'Встановити обов\'язкове сповіщення для групи (Тільки для Адмінів групи)' })
    @ApiParam({ name: 'groupId', required: true, description: 'ID групи користувачів (UserGroup)' })
    @ApiBody({ type: SetGroupRequirementDto })
    @ApiResponse({ status: 200, description: 'Обов\'язкове правило встановлено.' })
    @ApiResponse({ status: 403, description: 'Користувач не є адміністратором групи.' })
    async setGroupRequirement(
        @Req() req,
        @Param('groupId') groupId: string,
        @Body() body: SetGroupRequirementDto
    ) {
        return this.notificationService.setGroupMandatoryRequirement(req.user.id, groupId, body.typeId, body.isMandatory);
    }
}