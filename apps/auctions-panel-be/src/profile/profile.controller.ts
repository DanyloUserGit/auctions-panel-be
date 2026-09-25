import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { MailService } from '../mail/mail.service';
import { type ChangePasswordDto, ChangePasswordSchema } from './dto/ChangePasswordDto.dto';
import {
  type ChangeRoleDto,
  ChangeRoleSchema,
  ChangeRoleSwaggerDto,
} from './dto/ChangeRoleDto.dto';
import {
  type EditProfileDto,
  EditProfileSchema,
  EditProfileSwaggerDto,
} from './dto/EditProfileDto.dto';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(
    private profileService: ProfileService,
    private mailService: MailService
  ) {}

  @Audit('profile.update', 'Змінено профіль {body.id}')
  @Patch('edit')
  @ApiCreatedResponse({
    description: 'Профіль успішно оновлено',
    schema: {
      allOf: [{ $ref: getSchemaPath(EditProfileSwaggerDto) }],
    },
  })
  editProfile(@Req() req, @Body() body: EditProfileDto) {
    const data = EditProfileSchema.parse(body);
    return this.profileService.editProfile(req.user, data);
  }

  @Audit('user.role', 'Роль користувача {body.id} змінено на {body.role}')
  @Patch('change-role')
  @ApiCreatedResponse({
    description: 'Профіль успішно оновлено',
    schema: {
      allOf: [{ $ref: getSchemaPath(ChangeRoleSwaggerDto) }],
    },
  })
  changeRole(@Req() req, @Body() body: ChangeRoleDto) {
    const data = ChangeRoleSchema.parse(body);
    return this.profileService.changeRole(req.user, data);
  }

  @Audit('profile.password', 'Змінено пароль (через посилання зі скидання)')
  @Patch('change-password/:tokenId')
  changePassword(@Req() req, @Body() dto: ChangePasswordDto, @Param('tokenId') tokenId: string) {
    const data = ChangePasswordSchema.parse(dto);
    return this.profileService.changePassword(req.user, data, tokenId);
  }

  @Post('send-reset-link')
  sendResetLink(@Req() req) {
    return this.profileService.sendResetLink(req.user);
  }
}
