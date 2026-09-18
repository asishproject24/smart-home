"""
Django settings for the Smart Home Control System backend.
Dev-friendly defaults — tighten before deploying to production.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
# Project root that holds index.html / styles.css / script.js (one level up)
FRONTEND_DIR = BASE_DIR.parent

# Production (PythonAnywhere): set these in the WSGI file via os.environ.
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-insecure-change-me-in-production')
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'
# dev: '*' allows the ESP32 + LAN devices; prod: comma-separated hosts, e.g. "user.pythonanywhere.com"
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', '*').split(',')
CSRF_TRUSTED_ORIGINS = [f'https://{h}' for h in ALLOWED_HOSTS if h != '*']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# Dev: let the dashboard (or any origin) call the API from anywhere.
CORS_ALLOW_ALL_ORIGINS = True

ROOT_URLCONF = 'smarthome.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [FRONTEND_DIR],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'smarthome.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Dhaka'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ── Django REST Framework: open API for this local IoT project ──
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
}

# ── Smart-home alert thresholds (match the Overview dashboard) ──
TEMP_ALERT_C   = 30      # High Temperature Alert  above this
HUMIDITY_ALERT = 60      # High Humidity Alert     above this
LIGHT_ALERT_LUX = 200    # Low Light Alert         below this
