#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
  # Named volumes are created root-owned: hand the upload directory to "app",
  # then re-run this script without root privileges.
  chown app:app /app/media
  exec setpriv --reuid=app --regid=app --init-groups "$0" "$@"
fi

# Only the web container migrates; the worker starts with RUN_MIGRATIONS=0.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  python manage.py migrate --noinput
  python manage.py ensure_admin
fi

exec "$@"
