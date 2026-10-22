FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Current system time-zone rules (Morocco's UTC offset changes are published here).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/media /app/staticfiles \
    && DJANGO_SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput \
    && chown -R app:app /app \
    && chmod +x /app/entrypoint.sh

# The entrypoint starts as root only to fix the media volume's ownership,
# then drops to the unprivileged "app" user.

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
# Tune with WEB_CONCURRENCY (worker count) or GUNICORN_CMD_ARGS.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--timeout", "120", "--access-logfile", "-"]
