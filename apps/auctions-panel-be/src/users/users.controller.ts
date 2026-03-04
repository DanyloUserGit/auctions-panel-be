import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CreateUserSchema, CreateUserSwaggerDto, type CreateUserDto } from './dto/create-user.dto';
import { UpdateUserSchema, type UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { SearchUserDto, SearchUserResponseDto } from './dto/search-user.dto';
import { Public } from '../decorators/public.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search users with pagination' })
  @ApiOkResponse({
    description: 'Users found successfully',
    type: SearchUserResponseDto,
  })
  async search(@Query() dto: SearchUserDto, @Req() req): Promise<SearchUserResponseDto> {
    return this.usersService.searchUsers(dto, req.user);
  }

  @Post()
  @ApiBody({ type: CreateUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'Uuid' },
          },
        },
        { $ref: getSchemaPath(CreateUserSwaggerDto) },
      ],
    },
  })
  @Public()
  create(@Body() createUserDto: CreateUserDto, @Req() req) {
    const data = CreateUserSchema.parse(createUserDto);
    return this.usersService.create(data, req.user);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiBody({ type: CreateUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'Uuid' },
          },
        },
        { $ref: getSchemaPath(CreateUserSwaggerDto) },
      ],
    },
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    const data = UpdateUserSchema.parse(updateUserDto);
    return this.usersService.update(id, data);
  }

  @Get(':id/control-card')
  @ApiOperation({ summary: 'Отримати картку контролю користувача (ТЗ 15.3)' })
  async getControlCard(@Param('id') id: string, @Req() req) {
    return this.usersService.getUserControlCard(id, req.user);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Зміна статусу/блокування користувача' })
  async updateStatus(@Param('id') id: string, @Body() statusDto: { isBlocked: boolean }) {
    return this.usersService.updateUserStatus(id, statusDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
