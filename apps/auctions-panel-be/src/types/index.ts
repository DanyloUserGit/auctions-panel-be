export type AccessToken = {
  access_token: string;
};
export type AccessTokenPayload = {
  email: string;
  password: string;
};
export interface CarDbRow {
  id: number;
  brand_id: number;
  model_id: number;
  fuel: string | null;
  transmission: string | null;
  eng_power_kw: number | null;
  eng_capacity: number | null;
  mileage: number;
  first_on_road: number;
  price: number;
  chassis: string | null;
}