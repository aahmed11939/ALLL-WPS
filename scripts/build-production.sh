#!/usr/bin/env bash
set -e

echo "=== Building api-server ==="
pnpm --filter @workspace/api-server run build

echo "=== Building React frontend ==="
cd frontend && npm install --legacy-peer-deps && npm run build

echo "=== Build complete ==="
