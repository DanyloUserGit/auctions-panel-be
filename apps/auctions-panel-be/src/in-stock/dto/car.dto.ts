import { z } from 'zod';

// VIN: 17 символів без I, O, Q (ISO 3779).
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export const CAR_STATUSES = ['available', 'reserved', 'sold'] as const;
export type CarStatus = (typeof CAR_STATUSES)[number];

const currentYear = new Date().getFullYear();

export const CarSchema = z.object({
  brandId: z.coerce.number().int().positive({ message: 'Оберіть марку зі списку' }),
  modelId: z.coerce.number().int().positive({ message: 'Оберіть модель зі списку' }),
  year: z.coerce.number().int().min(1950).max(currentYear + 1),
  price: z.coerce.number().positive({ message: 'Вкажіть коректну ціну' }),
  mileage: z.coerce.number().int().nonnegative().default(0),
  engine: z.string().trim().max(100).default(''),
  transmission: z.enum(['Automatic', 'Mechanic']).default('Automatic'),
  chassis: z
    .string()
    .trim()
    .toUpperCase()
    .regex(VIN_REGEX, { message: 'VIN має містити 17 символів (латинські літери без I, O, Q та цифри)' }),
  status: z.enum(CAR_STATUSES).default('available'),
  location: z.string().trim().max(500).default(''),
  // Упорядкований список фото: перше - головне.
  photos: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
});

export type CarDto = z.infer<typeof CarSchema>;

// Авто, виставлене на продаж зі сторінки «Покупки» (ТЗ 13.2): ID виграного авто.
export const CreateCarSchema = CarSchema.extend({
  sourcePurchaseId: z.coerce.number().int().positive().optional(),
}).refine((car) => car.status !== 'sold', {
  message: 'Неможливо створити нове авто одразу зі статусом «Продано»',
  path: ['status'],
});

export const CarFiltersSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(CAR_STATUSES).optional(),
  priceFrom: z.coerce.number().nonnegative().optional(),
  priceTo: z.coerce.number().nonnegative().optional(),
});

export type CarFilters = z.infer<typeof CarFiltersSchema>;
