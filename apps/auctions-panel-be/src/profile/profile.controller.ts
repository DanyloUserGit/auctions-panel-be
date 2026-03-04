import { Body, Controller, Param, Patch, Post, Req } from '@nestjs/common';
import {
  type EditProfileDto,
  EditProfileSchema,
  EditProfileSwaggerDto,
} from './dto/EditProfileDto.dto';
import { ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import {
  type ChangeRoleDto,
  ChangeRoleSchema,
  ChangeRoleSwaggerDto,
} from './dto/ChangeRoleDto.dto';
import { ChangePasswordSchema, type ChangePasswordDto } from './dto/ChangePasswordDto.dto';
import { ProfileService } from './profile.service';
import { MailService } from '../mail/mail.service';
import { Public } from '../decorators/public.decorator';

@Controller('profile')
export class ProfileController {
  constructor(
    private profileService: ProfileService,
    private mailService: MailService
  ) {}

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
