import { z } from 'zod';
import { CreateOrderSchema } from './create-order.dto';

export const UpdateOrderSchema = CreateOrderSchema.partial();

export type UpdateOrderDto = z.infer<typeof UpdateOrderSchema>;
