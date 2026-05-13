#!/usr/bin/env bash
set -e

export NODE_ENV=production
export CI=true

echo "=== Building api-server ==="
pnpm --filter @workspace/api-server run build

echo "=== Building React frontend ==="
cd frontend && npm install --legacy-peer-deps --include=dev && npm run build

echo "=== Build complete ==="
