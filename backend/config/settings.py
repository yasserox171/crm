"""Django settings for the Centre Focus CRM.

Every deployment-specific value comes from environment variables (see
`.env.example` at the repository root).
"""

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off.")
    SECRET_KEY = "dev-only-insecure-secret-key"

# localhost is always allowed so the container health check works behind any domain;
# "backend" is how the internal WhatsApp service reaches the API.
ALLOWED_HOSTS = [*env_list("DJANGO_ALLOWED_HOSTS"), "localhost", "127.0.0.1", "backend"]
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "accounts",
    "crm",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

if env("DATABASE_URL"):
    DATABASES = {"default": dj_database_url.parse(env("DATABASE_URL"), conn_max_age=60, conn_health_checks=True)}
else:
    # Separate variables avoid URL-escaping problems with special characters in passwords.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": env("POSTGRES_HOST", "localhost"),
            "PORT": env("POSTGRES_PORT", "5440"),
            "NAME": env("POSTGRES_DB", "focus_crm"),
            "USER": env("POSTGRES_USER", "focus"),
            "PASSWORD": env("POSTGRES_PASSWORD", "focus"),
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
        }
    }

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internationalisation -------------------------------------------------
LANGUAGE_CODE = "fr"
LANGUAGES = [("fr", "Français"), ("ar", "العربية"), ("en", "English")]
TIME_ZONE = env("TIME_ZONE", "Africa/Casablanca")
USE_I18N = True
USE_TZ = True

# --- Static & media -------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = Path(env("STATIC_ROOT", BASE_DIR / "staticfiles"))
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", BASE_DIR / "media"))
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
# Uploaded videos can be large; files above this size are streamed to disk.
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
CONTENT_MEDIA_MAX_BYTES = int(env("CONTENT_MEDIA_MAX_MB", "50")) * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Sessions & security --------------------------------------------------
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# The SPA reads the CSRF cookie to send it back in the X-CSRFToken header.
CSRF_COOKIE_HTTPONLY = False
SECURE_COOKIES = env_bool("DJANGO_SECURE_COOKIES", not DEBUG)
SESSION_COOKIE_SECURE = SECURE_COOKIES
CSRF_COOKIE_SECURE = SECURE_COOKIES
if env_bool("DJANGO_BEHIND_HTTPS_PROXY", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# --- REST framework -------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "crm.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_RATES": {"login": env("LOGIN_THROTTLE_RATE", "10/min")},
}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Centre & integrations ------------------------------------------------
CENTER_NAME = env("CENTER_NAME", "Centre Focus")
CENTER_CITY = env("CENTER_CITY", "Safi")

# "whatsapp_web": sent from a WhatsApp account linked by QR code (see below);
# "manual": no API; each message opens pre-filled in WhatsApp and the staff
#           member presses Send (pending messages wait in an outbox);
# "whatsapp_cloud": sent automatically through the Meta WhatsApp Business Cloud API;
# "console": only logged (development / tests).
MESSAGING_BACKEND = env("MESSAGING_BACKEND", "console")
WHATSAPP_API_VERSION = env("WHATSAPP_API_VERSION", "v21.0")
WHATSAPP_TOKEN = env("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID", "")
# Business-initiated messages outside the 24h window need an approved template
# with a single body variable ({{1}}) that receives the rendered message text.
WHATSAPP_TEMPLATE_NAME = env("WHATSAPP_TEMPLATE_NAME", "")
WHATSAPP_TEMPLATE_LANG = env("WHATSAPP_TEMPLATE_LANG", "fr")

# "whatsapp_web": a WhatsApp account linked by QR code through the internal
# `whatsapp` service (unofficial; kept slow and low-volume to protect the number).
WHATSAPP_GATEWAY_URL = env("WHATSAPP_GATEWAY_URL", "http://whatsapp:3000")
WHATSAPP_GATEWAY_TOKEN = env("WHATSAPP_GATEWAY_TOKEN", "")
WA_WEB_DAILY_LIMIT = int(env("WA_WEB_DAILY_LIMIT", "40"))
WA_WEB_MIN_DELAY_SECONDS = int(env("WA_WEB_MIN_DELAY_SECONDS", "20"))
WA_WEB_MAX_DELAY_SECONDS = int(env("WA_WEB_MAX_DELAY_SECONDS", "45"))

ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = env("ANTHROPIC_MODEL", "claude-opus-5-5")

# How often the worker looks for queued messages; low so manual sends feel instant.
WORKER_INTERVAL_SECONDS = int(env("WORKER_INTERVAL_SECONDS", "2"))
AUTOMATION_INTERVAL_SECONDS = int(env("AUTOMATION_INTERVAL_SECONDS", "60"))
# Safety cap for one manual bulk send (also bounded by your WhatsApp Business tier).
MAX_BULK_RECIPIENTS = int(env("MAX_BULK_RECIPIENTS", "500"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
