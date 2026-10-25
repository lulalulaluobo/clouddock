#!/bin/sh
set -eu
if [ -z "${JWT_SECRET:-}" ]; then unset JWT_SECRET; fi
node /app/clouddock/init-runtime.cjs
ln -sf /app/config/env /app/.env
node /app/clouddock/boot.cjs &
app_pid=$!
nginx -g 'daemon off;' &
web_pid=$!
cleanup() { kill "$app_pid" "$web_pid" 2>/dev/null || true; }
trap cleanup TERM INT EXIT
# Stop the container if either server exits; the other must not remain a false
# healthy endpoint after an application failure.
while kill -0 "$app_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do sleep 1; done
exit 1
