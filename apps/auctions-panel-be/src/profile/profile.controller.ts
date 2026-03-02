import { Controller, Patch, Post, Req } from '@nestjs/common';
import { type EditProfileDto, EditProfileSchema, EditProfileSwaggerDto } from './dto/EditProfileDto.dto';
import { ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { type ChangeRoleDto, ChangeRoleSchema, ChangeRoleSwaggerDto } from './dto/ChangeRoleDto.dto';

@Controller('profile')
export class ProfileController {
    @Patch("edit")
    @ApiCreatedResponse({
        description: 'Профіль успішно оновлено',
        schema: {
            allOf: [
                { $ref: getSchemaPath(EditProfileSwaggerDto) },
            ],
        },
    })
    editProfile(@Req() req, body: EditProfileDto) {
        const data = EditProfileSchema.parse(body);
        return this.editProfile(req.user, data);
    }

    @Patch("change-role")
    @ApiCreatedResponse({
        description: 'Профіль успішно оновлено',
        schema: {
            allOf: [
                { $ref: getSchemaPath(ChangeRoleSwaggerDto) },
            ],
        },
    })
    changeRole(@Req() req, body: ChangeRoleDto) {
        const data = ChangeRoleSchema.parse(body);
        return this.changeRole(req.user, data);
    }

    @Post("send-reset-link")
    sendResetLink(@Req() req){
        return this.sendResetLink(req.user);
    }
}
