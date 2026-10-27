#!/bin/sh
set -e
if [ "$(id -u)" = "0" ]; then
  if [ "${STORE_BACKEND:-local}" = "local" ] && [ -n "${LOCAL_STORE_DIR:-}" ]; then
    mkdir -p "$LOCAL_STORE_DIR" && chown -R app "$LOCAL_STORE_DIR"
  fi
  # setpriv keeps root's environment; give the app user its own HOME so libraries (e.g. libpq looking for
  # ~/.postgresql client certs) don't try to read /root and fail with "Permission denied".
  export HOME=/srv USER=app
  exec setpriv --reuid=10001 --regid=10001 --init-groups -- "$0" "$@"
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --workers "${WEB_CONCURRENCY:-1}" \
  --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 30
