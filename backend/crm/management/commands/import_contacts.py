import csv
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from crm.models import Contact, ContactSource, ContactStatus, SchoolLevel
from crm.phone import InvalidPhoneNumber, normalize_phone

COLUMNS = [
    "first_name",
    "last_name",
    "phone",
    "city",
    "subject",
    "level",
    "status",
    "source",
    "consent",
    "registered_at",
]
TRUE_VALUES = {"1", "true", "oui", "yes", "y", "o", "نعم"}


def parse_date(value):
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


class Command(BaseCommand):
    help = (
        "Imports contacts from a UTF-8 CSV file (e.g. old Excel exports). Columns: "
        + ", ".join(COLUMNS)
        + ". Only first_name and phone are required. Numbers already in the CRM are skipped."
    )

    def add_arguments(self, parser):
        parser.add_argument("csv_path")
        parser.add_argument("--source", default=ContactSource.LEGACY, choices=ContactSource.values)
        parser.add_argument("--delimiter", default=",")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, csv_path, source, delimiter, dry_run, **options):
        try:
            handle = open(csv_path, newline="", encoding="utf-8-sig")
        except OSError as exc:
            raise CommandError(exc) from exc
        created, skipped, errors = 0, 0, []
        existing = set(Contact.objects.values_list("phone", flat=True))
        with handle, transaction.atomic():
            for line, row in enumerate(csv.DictReader(handle, delimiter=delimiter), start=2):
                row = {key.strip().lower(): (value or "").strip() for key, value in row.items() if key}
                try:
                    phone = normalize_phone(row.get("phone", ""))
                except InvalidPhoneNumber:
                    errors.append(f"line {line}: invalid phone {row.get('phone')!r}")
                    continue
                if not row.get("first_name"):
                    errors.append(f"line {line}: missing first_name")
                    continue
                if phone in existing:
                    skipped += 1
                    continue
                contact = Contact(
                    first_name=row["first_name"],
                    last_name=row.get("last_name", ""),
                    phone=phone,
                    city=row.get("city") or "Safi",
                    subject=row.get("subject", ""),
                    level=row.get("level") if row.get("level") in SchoolLevel.values else "",
                    status=row.get("status") if row.get("status") in ContactStatus.values else ContactStatus.NEW,
                    source=row.get("source") if row.get("source") in ContactSource.values else source,
                    consent=row.get("consent", "").lower() in TRUE_VALUES,
                )
                if registered_at := parse_date(row.get("registered_at", "")):
                    contact.registered_at = registered_at
                contact.save()
                existing.add(phone)
                created += 1
            if dry_run:
                transaction.set_rollback(True)
        for error in errors:
            self.stderr.write(error)
        prefix = "[dry run] " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(f"{prefix}{created} created, {skipped} already present, {len(errors)} rejected.")
        )
