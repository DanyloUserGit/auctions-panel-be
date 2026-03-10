import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MaterialVisibility, Roles, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';
import { CreateInfoPageDto, CreateTrainingDto, UpdateInfoPageDto } from './dto/create-training.dto';

@Injectable()
export class TrainingService {
    constructor(private prisma: PrismaService) {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
        });
    }

    async uploadImageToMaterial(materialId: string, file: Express.Multer.File, user: User) {
        console.log("materialId " + materialId);
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id: materialId } });
        console.log("material " + material)
        if (!material) {
            console.log('Матеріал не знайдено')
            throw new NotFoundException('Матеріал не знайдено');
        }

        const uploadFromBuffer = (fileBuffer: Buffer): Promise<any> => {
            return new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder: 'training-materials',
                        transformation: [{ width: 1000, crop: "limit", format: "auto", quality: "auto" }]
                    },
                    (error, result) => {
                        if (error) return reject(error);
                        resolve(result);
                    }
                );
                streamifier.createReadStream(fileBuffer).pipe(uploadStream);
            });
        };

        try {
            const result = await uploadFromBuffer(file.buffer);

            return await this.prisma.trainingMaterial.update({
                where: { id: materialId },
                data: { imageUrl: result.secure_url },
            });
        } catch (error) {
            throw new BadRequestException('Помилка при завантаженні зображення в Cloudinary');
        }
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

    async updateTrainingMaterial(id: string, user: User, data: CreateTrainingDto) {
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id } });
        if (!material) throw new NotFoundException('Матеріал не знайдено');

        if (user.role !== Roles.SuperAdmin) {
            const groupAdminInfo = await this.prisma.auctionGroup.findUnique({
                where: { groupAdminId: user.id }
            });

            if (!groupAdminInfo || material.groupId !== groupAdminInfo.id) {
                throw new ForbiddenException('Ви можете редагувати лише матеріали своєї групи');
            }
        }

        return this.prisma.trainingMaterial.update({
            where: { id },
            data,
        });
    }

    async getTrainingMaterials(user: any, search?: string) {
        const whereClause: any = { isPublished: true };

        if (search) {
            whereClause.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { content: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (user.role !== Roles.SuperAdmin) {
            whereClause.AND = [
                {
                    OR: [
                        { visibility: MaterialVisibility.All },
                        { visibility: MaterialVisibility.Group, groupId: user.auctionGroupId },
                    ],
                },
                {
                    OR: [
                        { allowedRoles: { isEmpty: true } },
                        { allowedRoles: { has: user.role } },
                    ],
                },
            ];
        }

        return this.prisma.trainingMaterial.findMany({
            where: whereClause,
            include: { author: { select: { firstName: true, lastName: true } } },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getTrainingMaterialById(id: string, user: any) {
        const material = await this.prisma.trainingMaterial.findUnique({ where: { id } });
        if (!material) throw new NotFoundException('Матеріал не знайдено');

        if (user.role !== Roles.SuperAdmin && material.visibility === MaterialVisibility.Group) {
            if (material.groupId !== user.auctionGroupId) {
                throw new ForbiddenException('У вас немає доступу до цього матеріалу');
            }
        }

        return material;
    }

    async createTrainingMaterial(user: User, data: CreateTrainingDto) {
        const isSuperAdmin = user.role === Roles.SuperAdmin;
        const groupAdminInfo = await this.prisma.auctionGroup.findUnique({
            where: { groupAdminId: user.id }
        });
        const isGroupAdmin = !!groupAdminInfo;

        if (!isSuperAdmin && !isGroupAdmin) {
            throw new ForbiddenException('Тільки адміністратори можуть створювати матеріали');
        }
        if (!groupAdminInfo) {
            throw new ForbiddenException('Групи відсутні у адміністратора');
        } else {
            const finalData = {
                ...data,
                authorId: user.id,
                groupId: isSuperAdmin ? data.groupId : groupAdminInfo.id,
                visibility: isSuperAdmin ? (data.visibility || MaterialVisibility.All) : MaterialVisibility.Group,
            };
            return this.prisma.trainingMaterial.create({ data: finalData });
        }

    }

    async togglePublishStatus(id: string, isPublished: boolean, user: any) {
        return this.prisma.trainingMaterial.update({
            where: { id },
            data: { isPublished },
        });
    }
}