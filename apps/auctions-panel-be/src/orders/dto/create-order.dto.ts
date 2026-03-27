import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class CreateOrderDto {
    @IsOptional() @IsString() brand_names?: string;
    @IsOptional() @IsString() model_names?: string;
    @IsOptional() @IsString() gearbox_names?: string;
    @IsOptional() @IsString() fuel_names?: string;

    @IsOptional() @IsString() budget_currency?: string;
    @IsOptional() @IsString() purchase_budget?: string;

    @IsOptional() @IsNumber() year_from_ts?: number;
    @IsOptional() @IsNumber() year_to_ts?: number;

    @IsOptional() @IsNumber() mileage_from?: number;
    @IsOptional() @IsNumber() mileage_to?: number;

    @IsOptional() @IsNumber() engine_cc_from?: number;
    @IsOptional() @IsNumber() engine_cc_to?: number;

    @IsOptional()
    @IsIn(['new', 'selection', 'completed', 'paused', 'cancelled'])
    status?: string = 'new';
}