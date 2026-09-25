import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { NotificationChannel, Roles } from '@prisma/client';
import { z } from 'zod';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { ReminderSchema, RemindersService } from './reminders.service';
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

const UpdateSettingsSchema = z.object({
    typeId: z.string().uuid(),
    isEnabled: z.boolean().optional(),
    channels: z.array(z.nativeEnum(NotificationChannel)).optional(),
    value: z.number().int().min(0).optional(),
});

const SetGroupRequirementSchema = z.object({ typeId: z.string().uuid(), isMandatory: z.boolean() });

class SetGroupRequirementDto {
    @ApiProperty({ description: 'ID типу сповіщення', example: '123e4567-e89b-12d3-a456-426614174000' })
    typeId!: string;

    @ApiProperty({ description: 'Чи є сповіщення обов\'язковим', example: true })
    isMandatory!: boolean;
}

@Controller('notifications')
export class NotificationController {
    constructor(
        private readonly notificationService: NotificationService,
        private readonly reminders: RemindersService,
    ) { }

    // Нагадування про завершення аукціону (ТЗ 15).
    @Get('reminders')
    listReminders(@Req() req) {
        return this.reminders.list(req.user.id);
    }

    @Post('reminders')
    createReminder(@Req() req, @Body() body: unknown) {
        return this.reminders.create(req.user.id, ReminderSchema.parse(body));
    }

    @Delete('reminders/:id')
    removeReminder(@Req() req, @Param('id') id: string) {
        return this.reminders.remove(req.user.id, id);
    }

    @Get('settings')
    async getMySettings(@Req() req) {
        return this.notificationService.getUserSettings(req.user.id);
    }

    @Get('my-groups')
    @ApiOperation({ summary: 'Отримати список груп користувачів, де поточний користувач є адміністратором' })
    async getMyGroups(@Req() req) {
        return this.notificationService.getMyAdminGroups(req.user.id);
    }

    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin)
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
        @Body() raw: unknown
    ) {
        const body = UpdateSettingsSchema.parse(raw);
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

    @Audit('notifications.group-requirement', 'Змінено обов’язкові сповіщення групи {params.groupId}')
    @Patch('group/:groupId/requirements')
    @ApiOperation({ summary: 'Встановити обов\'язкове сповіщення для групи (Тільки для Адмінів групи)' })
    @ApiParam({ name: 'groupId', required: true, description: 'ID групи користувачів (UserGroup)' })
    @ApiBody({ type: SetGroupRequirementDto })
    @ApiResponse({ status: 200, description: 'Обов\'язкове правило встановлено.' })
    @ApiResponse({ status: 403, description: 'Користувач не є адміністратором групи.' })
    async setGroupRequirement(
        @Req() req,
        @Param('groupId') groupId: string,
        @Body() raw: unknown
    ) {
        const body = SetGroupRequirementSchema.parse(raw);
        return this.notificationService.setGroupMandatoryRequirement(req.user.id, groupId, body.typeId, body.isMandatory);
    }
}