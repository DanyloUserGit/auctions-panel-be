#!/bin/sh
set -e

# Шлях до файлу зі змінними всередині контейнера
# Docker Compose монтує змінні з env_file в оточення, 
# але ми можемо перестрахуватися:
if [ -f .env ]; then
  export $(echo $(cat .env | sed 's/#.*//g' | xargs) | envsubst)
fi

echo "Running database migrations..."
# Додаємо пряме вказання DATABASE_URL, якщо вона є в оточенні
npx prisma migrate deploy --schema=./prisma/schema.prisma

exec "$@"