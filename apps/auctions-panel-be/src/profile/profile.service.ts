import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Roles, User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../utils/password';
import { ChangePasswordDto } from './dto/ChangePasswordDto.dto';
import { ChangeRoleDto } from './dto/ChangeRoleDto.dto';
import { EditProfileDto } from './dto/EditProfileDto.dto';

@Injectable()
export class ProfileService {
  constructor(
    private prismaService: PrismaService,
    private mailService: MailService
  ) { }
  async editProfile(user: User, body: EditProfileDto) {
    try {
      const isAdmin = user.role === Roles.SuperAdmin;
      if (!user?.id) {
        throw new ForbiddenException('Потрібна авторизація');
      }

      if (!isAdmin || user.id !== body.id) {
        if (user.id !== body.id) throw new ForbiddenException('Доступ заборонено');
      }

      let dataToUpdate: Partial<EditProfileDto> = { ...body };

      delete dataToUpdate.id;

      if (!isAdmin) {
        const currentUser = await this.prismaService.user.findUnique({
          where: { id: user.id },
          select: { userGroup: { select: { allowedProfileFields: true } } }
        });

        const allowedFields = currentUser?.userGroup?.allowedProfileFields || [];

        dataToUpdate = Object.keys(dataToUpdate).reduce((acc, key) => {
          if (allowedFields.includes(key)) {
            acc[key] = dataToUpdate[key];
          }
          return acc;
        }, {} as Partial<EditProfileDto>);

        if (Object.keys(dataToUpdate).length === 0) {
          throw new BadRequestException('У вас немає прав для зміни цих полів');
        }
      }

      return await this.prismaService.user.update({
        where: { id: body.id },
        data: dataToUpdate,
      });
    } catch (error) {
      if ((error as any).code === 'P2002') {
        throw new BadRequestException('Цей email вже використовується');
      }
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Помилка при редагуванні профілю');
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
          ...body,
        },
      });
    } catch (error) {
      throw new BadRequestException('Помилка при редагуванні профілю');
    }
  }

  async sendResetLink(user: User) {
    if (!user) throw new NotFoundException('Користувача не знайдено');

    await this.prismaService.resetToken.deleteMany({ where: { userId: user.id } });

    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 30);

    const tokenRecord = await this.prismaService.resetToken.create({
      data: {
        userId: user.id,
        expiresAt: expiry,
      },
    });

    // Посилання веде на фронтенд (сторінка /reset-password/:id), а не на API.
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const resetLink = `${frontend}/reset-password/${tokenRecord.id}`;

    await this.mailService.send(
      user.email,
      'Зміна паролю',
      `<p>Ваше посилання на зміну пароля: <a href="${resetLink}">${resetLink}</a></p>`,
    );

    return { status: 'ok', message: 'Посилання для скидання надіслано' };
  }

  async cleanExpiredTokens() {
    return await this.prismaService.resetToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  async changePassword(user: User, dto: ChangePasswordDto, tokenId: string) {
    const resetToken = await this.prismaService.resetToken.findUnique({
      where: { id: tokenId },
      include: { user: true },
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
