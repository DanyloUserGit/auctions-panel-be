import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { Public } from 'src/decorators/public.decorator';
import { SearchUserDto, SearchUserResponseDto } from './dto/search-user.dto';

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
  async search(@Query() dto: SearchUserDto): Promise<SearchUserResponseDto> {
    return this.usersService.searchUsers(dto);
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
  create(@Body() createUserDto: CreateUserDto) {
    const data = CreateUserSchema.parse(createUserDto);
    return this.usersService.create(data);
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

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
