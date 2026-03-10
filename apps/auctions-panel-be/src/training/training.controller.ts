import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { CreateInfoPageDto, CreateTrainingDto } from './dto/create-training.dto';
import { TrainingService } from './training.service';

@ApiTags('Training & Information')
@Controller('training')
export class TrainingController {
    constructor(private readonly trainingService: TrainingService) { }

    @Get('info')
    @ApiOperation({ summary: 'Отримати список всіх інформаційних сторінок (FAQ, правила)' })
    @ApiResponse({ status: 200, description: 'Список інформаційних сторінок успішно отримано.' })
    getAllInfoPages() {
        return this.trainingService.getAllInfoPages();
    }

    @Get('info/:slug')
    @ApiOperation({ summary: 'Отримати інформаційну сторінку за її slug (URL)' })
    @ApiParam({ name: 'slug', description: 'Унікальний ідентифікатор сторінки (наприклад: rules, faq)' })
    @ApiResponse({ status: 200, description: 'Сторінку успішно знайдено.' })
    @ApiResponse({ status: 404, description: 'Сторінку не знайдено.' })
    getInfoPageBySlug(@Param('slug') slug: string) {
        return this.trainingService.getInfoPageBySlug(slug);
    }

    @Post('info')
    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin)
    @ApiOperation({ summary: 'Створити нову інформаційну сторінку (Тільки SuperAdmin)' })
    @ApiResponse({ status: 201, description: 'Сторінку успішно створено.' })
    @ApiResponse({ status: 403, description: 'Доступ заборонено.' })
    createInfoPage(@Body() dto: CreateInfoPageDto) {
        return this.trainingService.createInfoPage(dto);
    }

    @Get('materials')
    @ApiOperation({ summary: 'Отримати список навчальних матеріалів (з урахуванням ролі та групи користувача)' })
    @ApiQuery({ name: 'search', required: false, description: 'Пошук по заголовку або тексту матеріалу' })
    @ApiResponse({ status: 200, description: 'Список матеріалів успішно отримано.' })
    getMaterials(@Req() req, @Query('search') search?: string) {
        return this.trainingService.getTrainingMaterials(req.user, search);
    }

    @Get('materials/:id')
    @ApiOperation({ summary: 'Отримати навчальний матеріал за його ID' })
    @ApiParam({ name: 'id', description: 'UUID матеріалу' })
    @ApiResponse({ status: 200, description: 'Матеріал успішно знайдено.' })
    @ApiResponse({ status: 403, description: 'Немає доступу до матеріалу цієї групи.' })
    @ApiResponse({ status: 404, description: 'Матеріал не знайдено.' })
    getMaterialById(@Param('id') id: string, @Req() req) {
        return this.trainingService.getTrainingMaterialById(id, req.user);
    }

    @Post('materials')
    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin, Roles.Admin)
    @ApiOperation({ summary: 'Створити новий навчальний матеріал (SuperAdmin, Admin)' })
    @ApiResponse({ status: 201, description: 'Матеріал успішно створено.' })
    @ApiResponse({ status: 403, description: 'Тільки адміністратори можуть створювати матеріали.' })
    createMaterial(@Req() req, @Body() dto: CreateTrainingDto) {
        return this.trainingService.createTrainingMaterial(req.user, dto);
    }

    @Patch('materials/:id/publish')
    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin, Roles.Admin)
    @ApiOperation({ summary: 'Змінити статус публікації матеріалу (Опубліковано / Чернетка)' })
    @ApiParam({ name: 'id', description: 'UUID матеріалу' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                isPublished: {
                    type: 'boolean',
                    description: 'Статус публікації',
                    example: true
                }
            }
        }
    })
    @ApiResponse({ status: 200, description: 'Статус успішно оновлено.' })
    togglePublish(
        @Param('id') id: string,
        @Body('isPublished') isPublished: boolean,
        @Req() req,
    ) {
        return this.trainingService.togglePublishStatus(id, isPublished, req.user);
    }

    @Post('materials/:id/image')
    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin, Roles.Admin)
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Завантажити зображення для навчального матеріалу' })
    @ApiConsumes('multipart/form-data')
    @ApiParam({ name: 'id', description: 'UUID матеріалу' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                    description: 'Файл зображення'
                },
            },
        },
    })
    @ApiResponse({ status: 201, description: 'Зображення успішно завантажено та прив\'язано до матеріалу.' })
    @ApiResponse({ status: 400, description: 'Помилка завантаження файлу.' })
    async uploadMaterialImage(
        @Param('id') id: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.trainingService.uploadImageToMaterial(id, file);
    }
}