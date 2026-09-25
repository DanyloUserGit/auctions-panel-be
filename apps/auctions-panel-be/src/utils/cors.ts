// Дозволені origin фронтенду для HTTP і сокетів. Задаються в .env (CORS_ORIGINS, через кому),
// щоб перенесення на інший сервер/домен не вимагало змін коду (ТЗ 21).
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://panel.caddyluck.com.ua'];

export function corsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}
