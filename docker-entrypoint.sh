#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "[docker] Running prisma migrate deploy..."
  npx --no-install prisma migrate deploy
fi

PORT="${PORT:-3000}"
echo "[docker] Starting Next.js on 0.0.0.0:${PORT}..."
exec npm run start -- -H 0.0.0.0 -p "${PORT}"
