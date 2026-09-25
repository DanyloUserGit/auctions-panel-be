#!/bin/sh
set -e

if [ -f .env ]; then
  echo "Loading variables from .env"
  export $(grep -v '^#' .env | xargs)
fi

# DATABASE_URL містить пароль - не друкуємо його в лог.

echo "Running database migrations..."
DATABASE_URL=$DATABASE_URL npx prisma migrate deploy --schema=./prisma/schema.prisma

exec "$@"