import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Roles, User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../utils/password';
import { ChangePasswordDto } from './dto/ChangePasswordDto.dto';
import { ChangeRoleDto } from './dto/ChangeRoleDto.dto';
import { EditProfileDto } from './dto/EditProfileDto.dto';

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
        expiry.setMinutes(expiry.getMinutes() + 2);

        const tokenRecord = await this.prismaService.resetToken.create({
            data: {
                userId: user.id,
                expiresAt: expiry,
            },
        });

        const resetLink = `${process.env.HOST || "http://localhost:8000"}/reset-password/${tokenRecord.id}`;

        await this.mailService.send(user.email, `<p>Ваше посилання на зміну пароля: <a href="${resetLink}">${resetLink}</a></p>`, "Зміна паролю")

        return { status: "ok", message: 'Посилання для скидання надіслано' };
    }

    async cleanExpiredTokens() {
        return await this.prismaService.resetToken.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
    }

    async changePassword(user: User, dto: ChangePasswordDto, tokenId: string) {
        const resetToken = await this.prismaService.resetToken.findUnique({
            where: { id: tokenId },
            include: { user: true }
        });
        if (!resetToken || resetToken.userId !== user.id) {
            throw new ForbiddenException('Недійсний токен або доступ заборонено');
        }
        if (new Date() > resetToken.expiresAt) {
            await this.prismaService.resetToken.delete({ where: { id: tokenId } });
            throw new BadRequestException('Термін дії посилання вичерпано');
        }
        const hashedPassword = await hashPassword(dto.password);
        await this.prismaService.$transaction([
            this.prismaService.user.update({
                where: { id: user.id },
                data: { password: hashedPassword },
            }),
            this.prismaService.resetToken.delete({
                where: { id: tokenId },
            }),
        ]);
        return { status: 'ok', message: 'Пароль успішно змінено' };
    }
}
