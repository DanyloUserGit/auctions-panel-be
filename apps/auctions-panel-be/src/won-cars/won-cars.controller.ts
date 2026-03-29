import { Controller, Get, Req, Query, UseGuards, ParseIntPipe, Patch, Param, Body } from '@nestjs/common';
import { WonCarsService } from './won-cars.service';
import { Roles } from '@prisma/client';
// import { JwtAuthGuard } from './guards/jwt-auth.guard'; // Ваш гард

@Controller('api/purchases')
export class WonCarsController {
    constructor(private readonly wonCarsService: WonCarsService) { }

    // @UseGuards(JwtAuthGuard)
    @Get()
    async getPurchases(@Req() req, @Query('dbName') dbName: string, @Query('page') page = 1) {
        const userId = req.user.id; // Отримуємо з токена
        const isAdmin = req.user.role === Roles.SuperAdmin; // Ваша логіка ролей

        const limit = 20;
        const offset = (page - 1) * limit;

        return this.wonCarsService.getWonCarsData(dbName, userId, isAdmin, limit, offset);
    }

    @Patch(':id/status')
    async updateStatus(
        @Req() req,
        @Param('id', ParseIntPipe) id: number,
        @Body('status', ParseIntPipe) status: number,
        @Body('dbName') dbName: string
    ) {
        const isAdmin = req.user.role === Roles.SuperAdmin;

        return this.wonCarsService.updateCarStatus(dbName, id, status, isAdmin);
    }
}