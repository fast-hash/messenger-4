#!/usr/bin/env bash
set -euo pipefail
NODE_ENV=production MONGO_URL="" REDIS_URL="" node server/index.js & pid=$! || true
sleep 1
if ps -p $pid > /dev/null; then
  echo "ERROR: server started without real MONGO/REDIS in production"
  kill $pid || true
  exit 1
fi
NODE_ENV=production MONGO_URL=mongodb://localhost:27017/testdb REDIS_URL=redis://localhost:6379 node server/index.js & pid=$!
sleep 1
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/__test__/bootstrap || true)
kill $pid || true
test "$code" = "404" -o "$code" = "403" || (echo "ERROR: test bootstrap endpoint is exposed in production" && exit 1)
echo "OK: fail-fast works and no test endpoints in production"
