import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginSchema, LoginSwaggerDto, LoginSwaggerResDto, type LoginDto } from './dto/LoginDto';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { Public } from 'src/decorators/public';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiBody({ type: LoginSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(LoginSwaggerResDto) }],
    },
  })
  @Public()
  @Post('login')
  async login(@Res({ passthrough: true }) res: Response, @Body() body: LoginDto) {
    const data = LoginSchema.parse(body);
    const tokens = await this.authService.login(data);

    res.cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });

    return { success: true };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const oldRefresh = req.cookies['refresh_token'];

    const tokens = await this.authService.refresh(oldRefresh);

    res.cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });

    return { success: true };
  }
  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies['refresh_token'];

    await this.authService.logout(refreshToken);

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');

    return { success: true };
  }
  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async me(@Req() req) {
    return req.user;
  }
}
