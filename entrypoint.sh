#!/bin/sh
set -e

# Завантажуємо змінні з .env, якщо він існує
if [ -f .env ]; then
  echo "Loading variables from .env"
  export $(grep -v '^#' .env | xargs)
fi

# Перевірка, чи змінна встановилася (для дебагу в логах)
echo "DATABASE_URL is set to: $DATABASE_URL"

echo "Running database migrations..."
# Прямо передаємо змінну в команду Prisma
DATABASE_URL=$DATABASE_URL npx prisma migrate deploy --schema=./prisma/schema.prisma

exec "$@"