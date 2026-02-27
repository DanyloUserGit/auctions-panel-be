#!/bin/sh
set -e

if [ -f .env ]; then
  echo "Loading variables from .env"
  export $(grep -v '^#' .env | xargs)
fi

echo "DATABASE_URL is set to: $DATABASE_URL"

echo "Running database migrations..."
DATABASE_URL=$DATABASE_URL npx prisma migrate deploy --schema=./prisma/schema.prisma

exec "$@"