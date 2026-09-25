import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MaterialVisibility, Roles, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

import { UploadsService } from '../uploads/uploads.service';
import { managedGroupWhere } from '../users/managed-group';
import { CreateInfoPageDto, CreateTrainingDto, UpdateInfoPageDto } from './dto/create-training.dto';


@Injectable()
export class TrainingService {
    constructor(
        private prisma: PrismaService,
        private uploads: UploadsService,
    ) { }

    // Зображення зберігається на сервері платформи (ТЗ 1: без зовнішніх сервісів).
    // GA завантажує лише для матеріалів своєї групи.
    async uploadImageToMaterial(materialId: string, file: Express.Multer.File, user: User) {
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id: materialId } });
        if (!material) {
            throw new NotFoundException('Матеріал не знайдено');
        }
        if (user.role !== Roles.SuperAdmin) {
            const group = await this.prisma.userGroup.findFirst({ where: managedGroupWhere(user.id), select: { id: true } });
            if (!group || material.groupId !== group.id) {
                throw new ForbiddenException('Ви можете змінювати лише матеріали своєї групи');
            }
        }

        const imageUrl = await this.uploads.saveImage('training', file);
        return this.prisma.trainingMaterial.update({
            where: { id: materialId },
            data: { imageUrl },
        });
    }

    async getAllInfoPages(search?: string) {
        const whereClause: any = {};

        if (search) {
            whereClause.OR = [
                { title: { contains: search, mode: 'insensitive' } },
            ];
        }

        return this.prisma.informationPage.findMany({
            where: whereClause,
            select: { id: true, title: true, slug: true },
        });
    }

    async getInfoPageBySlug(slug: string) {
        const page = await this.prisma.informationPage.findUnique({ where: { slug } });
        if (!page) throw new NotFoundException('Сторінку не знайдено');
        return page;
    }

    async createInfoPage(data: CreateInfoPageDto) {
        return this.prisma.informationPage.create({ data });
    }

    async updateInfoPage(id: string, data: UpdateInfoPageDto) {
        const page = await this.prisma.informationPage.findUnique({ where: { id } });
        if (!page) throw new NotFoundException('Інформаційну сторінку не знайдено');

        return this.prisma.informationPage.update({
            where: { id },
            data,
        });
    }

    async updateTrainingMaterial(id: string, user: User, data: Partial<CreateTrainingDto>) {
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id } });
        if (!material) throw new NotFoundException('Матеріал не знайдено');

        if (user.role !== Roles.SuperAdmin) {
            const AdminInfo = await this.prisma.userGroup.findFirst({
                where: managedGroupWhere(user.id)
            });

            if (!AdminInfo || material.groupId !== AdminInfo.id) {
                throw new ForbiddenException('Ви можете редагувати лише матеріали своєї групи');
            }
            // GA публікує лише в межах своєї групи (ТЗ 17): групу й видимість змінює тільки SuperAdmin.
            data = { ...data, groupId: AdminInfo.id, visibility: MaterialVisibility.Group };
        }

        return this.prisma.trainingMaterial.update({
            where: { id },
            data,
        });
    }

    // Група, у межах якої користувач бачить матеріали: GA - група, якою керує; User - своя група.
    private async viewerGroupId(user: { id: string; role: Roles; userGroupId?: string | null }) {
        if (user.role === Roles.Admin) {
            const group = await this.prisma.userGroup.findFirst({ where: managedGroupWhere(user.id), select: { id: true } });
            return group?.id ?? null;
        }
        return user.userGroupId ?? null;
    }

    // Список (ТЗ 17): SA - усі; GA - загальні, своєї групи (включно з неопублікованими, щоб їх редагувати);
    // User - опубліковані загальні та своєї групи, з урахуванням ролей.
    async getTrainingMaterials(user: any, search?: string) {
        const and: any[] = [];
        if (search) {
            and.push({
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { content: { contains: search, mode: 'insensitive' } },
                ],
            });
        }

        if (user.role !== Roles.SuperAdmin) {
            const groupId = await this.viewerGroupId(user);
            const visible = {
                AND: [
                    { OR: [{ visibility: MaterialVisibility.All }, ...(groupId ? [{ visibility: MaterialVisibility.Group, groupId }] : [])] },
                    { OR: [{ allowedRoles: { isEmpty: true } }, { allowedRoles: { has: user.role } }] },
                ],
            };
            and.push(
                user.role === Roles.Admin && groupId
                    ? { OR: [{ AND: [{ isPublished: true }, visible] }, { groupId }] }
                    : { isPublished: true, ...visible },
            );
        }

        return this.prisma.trainingMaterial.findMany({
            where: { AND: and },
            include: { author: { select: { firstName: true, lastName: true } } },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getTrainingMaterialById(id: string, user: any) {
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id } });
        if (!material) throw new NotFoundException('Матеріал не знайдено');

        if (user.role !== Roles.SuperAdmin && material.visibility === MaterialVisibility.Group) {
            if (material.groupId !== (await this.viewerGroupId(user))) {
                throw new ForbiddenException('У вас немає доступу до цього матеріалу');
            }
        }

        return material;
    }

    // SA публікує для всіх (або для групи/ролей), GA - лише в межах своєї групи (ТЗ 17).
    async createTrainingMaterial(user: User, data: CreateTrainingDto) {
        if (user.role === Roles.SuperAdmin) {
            return this.prisma.trainingMaterial.create({
                data: { ...data, authorId: user.id, visibility: data.visibility || MaterialVisibility.All },
            });
        }

        const group = await this.prisma.userGroup.findFirst({ where: managedGroupWhere(user.id), select: { id: true } });
        if (!group) {
            throw new ForbiddenException('Адміністратор без групи не може створювати матеріали');
        }
        return this.prisma.trainingMaterial.create({
            data: { ...data, authorId: user.id, groupId: group.id, visibility: MaterialVisibility.Group },
        });
    }

    async togglePublishStatus(id: string, isPublished: boolean, user: User) {
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id }, select: { groupId: true } });
        if (!material) throw new NotFoundException('Матеріал не знайдено');
        if (user.role !== Roles.SuperAdmin && material.groupId !== (await this.viewerGroupId(user))) {
            throw new ForbiddenException('Ви можете публікувати лише матеріали своєї групи');
        }
        return this.prisma.trainingMaterial.update({
            where: { id },
            data: { isPublished: !!isPublished },
        });
    }
}
