import { z } from 'zod';

const text = (max = 1000) => z.string().trim().max(max).nullish();
const int = z.coerce.number().int().nullish();
const money = z.coerce.number().nonnegative().nullish();

// Лише ці колонки car_orders можна записувати з API. Ключі тіла запиту ніколи не потрапляють у SQL
// напряму: невідомі поля відкидаються, а user (власник) задає сервер.
export const CreateOrderSchema = z.object({
    first_name: text(100),
    last_name: text(100),
    phone: text(255),
    internal_id: text(50),
    brand_names: text(),
    brand_ids_csv: text(),
    model_names: text(),
    fuel_names: text(),
    gearbox_names: text(),
    engine_cc: int,
    year_from_ts: int,
    year_to_ts: int,
    price_from: money,
    price_to: money,
    mileage_from: int,
    mileage_to: int,
    options_txt: text(5000),
    extra_info: text(5000),
    engine_cc_from: int,
    engine_cc_to: int,
});

export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;

export const ORDER_COLUMNS = Object.keys(CreateOrderSchema.shape) as (keyof CreateOrderDto)[];
