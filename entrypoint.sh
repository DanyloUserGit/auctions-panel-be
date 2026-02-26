#!/bin/sh
set -e

# Виконуємо міграції перед стартом
echo "Running database migrations..."
npx prisma migrate deploy [cite: 2]

# Запускаємо основну команду (PM2)
exec "$@"