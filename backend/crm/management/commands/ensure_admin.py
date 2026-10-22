import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Creates the staff account from DJANGO_ADMIN_EMAIL / DJANGO_ADMIN_PASSWORD if it doesn't exist yet."

    def handle(self, *args, **options):
        email = os.environ.get("DJANGO_ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("DJANGO_ADMIN_PASSWORD", "")
        if not email or not password:
            self.stdout.write("DJANGO_ADMIN_EMAIL / DJANGO_ADMIN_PASSWORD not set; skipping.")
            return
        User = get_user_model()
        if User.objects.filter(email__iexact=email).exists():
            self.stdout.write(f"Account {email} already exists; password left unchanged.")
            return
        User.objects.create_superuser(email=email, password=password)
        self.stdout.write(self.style.SUCCESS(f"Created account {email}."))
