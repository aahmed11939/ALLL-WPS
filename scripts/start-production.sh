#!/usr/bin/env bash
set -e

export NODE_ENV=production

# Start FastAPI on internal port 8000
uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 &
FASTAPI_PID=$!

# Give FastAPI time to start before the api-server begins accepting proxied requests
sleep 3

echo "FastAPI started (pid $FASTAPI_PID) — starting api-server on port ${PORT:-8080}"

# Start Node api-server on $PORT (Replit injects PORT at runtime)
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
