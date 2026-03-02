import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles, User } from '@prisma/client';
import { EditProfileDto } from './dto/EditProfileDto.dto';
import { ChangeRoleDto } from './dto/ChangeRoleDto.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ProfileService {
    constructor(private prismaService: PrismaService, private mailService: MailService) { }
    async editProfile(user: User, body: EditProfileDto) {
        try {
            const isAdmin = user.role === Roles.SuperAdmin;
            if (!user?.id) {
                throw new ForbiddenException('Потрібна авторизація');
            }

            if (!isAdmin || user.id !== body.id) {
                throw new ForbiddenException('Доступ заборонено');
            }
            return await this.prismaService.user.update({
                where: { id: body.id },
                data: {
                    ...body
                }
            });
        } catch (error) {
            throw new BadRequestException("Помилка при редагуванні профілю")
        }
    }
    async changeRole(user: User, body: ChangeRoleDto) {
        try {
            const isAdmin = user.role === Roles.SuperAdmin;
            if (!user?.id) {
                throw new ForbiddenException('Потрібна авторизація');
            }

            if (!isAdmin) {
                throw new ForbiddenException('Доступ заборонено');
            }
            return await this.prismaService.user.update({
                where: { id: body.id },
                data: {
                    ...body
                }
            });
        } catch (error) {
            throw new BadRequestException("Помилка при редагуванні профілю")
        }
    }

    async sendResetLink(user: User) {
        if (!user) throw new NotFoundException('Користувача не знайдено');

        await this.prismaService.resetToken.deleteMany({ where: { userId: user.id } });

        const expiry = new Date();
        expiry.setHours(expiry.getMinutes() + 5);

        const tokenRecord = await this.prismaService.resetToken.create({
            data: {
                userId: user.id,
                expiresAt: expiry,
            },
        });

        const resetLink = `${process.env.HOST || "http://localhost:8000"}/reset-password/${tokenRecord.id}`;

        await this.mailService.send(user.email, `Ваше посилання на зміну пароля: ${resetLink}`, "Зміна паролю")

        return { status: "ok", message: 'Посилання для скидання надіслано' };
    }

    async cleanExpiredTokens() {
        return await this.prismaService.resetToken.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
    }
}
