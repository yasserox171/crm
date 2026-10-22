"""Domain operations shared by the API views, the automation engine and the admin."""

from django.db import transaction

from .models import (
    Appointment,
    AppointmentStatus,
    Contact,
    ContactStatus,
    InteractionKind,
    InteractionLog,
)

# Statuses an appointment may move a contact forward from.
_PRE_APPOINTMENT_STATUSES = {ContactStatus.NEW, ContactStatus.INTERESTED, ContactStatus.NO_ANSWER}


def change_status(contact: Contact, new_status: str, *, user=None, rule=None) -> bool:
    """Set a contact's status and log it in the timeline. Returns False if unchanged."""
    old_status = contact.status
    if old_status == new_status:
        return False
    contact.status = new_status
    contact.save(update_fields=["status", "status_changed_at", "updated_at"])
    InteractionLog.objects.create(
        contact=contact,
        kind=InteractionKind.STATUS_CHANGE,
        metadata={"from": old_status, "to": new_status},
        created_by=user,
        rule=rule,
    )
    return True


def add_tag(contact: Contact, tag: str) -> bool:
    tag = tag.strip()
    if not tag or tag in contact.tags:
        return False
    contact.tags = [*contact.tags, tag]
    contact.save(update_fields=["tags", "updated_at"])
    return True


def add_note(contact: Contact, body: str, *, user=None) -> InteractionLog:
    return InteractionLog.objects.create(contact=contact, kind=InteractionKind.NOTE, body=body.strip(), created_by=user)


@transaction.atomic
def record_appointment_created(appointment: Appointment, *, user=None) -> None:
    InteractionLog.objects.create(
        contact=appointment.contact,
        kind=InteractionKind.APPOINTMENT,
        appointment=appointment,
        body=appointment.title,
        metadata={"event": "created", "scheduled_at": appointment.scheduled_at.isoformat()},
        created_by=user,
    )
    if appointment.contact.status in _PRE_APPOINTMENT_STATUSES:
        change_status(appointment.contact, ContactStatus.APPOINTMENT_SET, user=user)


@transaction.atomic
def record_appointment_updated(appointment: Appointment, previous: dict, *, user=None) -> None:
    """Log reschedules and status changes (attended / no-show / cancelled)."""
    contact = appointment.contact
    if previous["scheduled_at"] != appointment.scheduled_at:
        InteractionLog.objects.create(
            contact=contact,
            kind=InteractionKind.APPOINTMENT,
            appointment=appointment,
            body=appointment.title,
            metadata={
                "event": "rescheduled",
                "from": previous["scheduled_at"].isoformat(),
                "scheduled_at": appointment.scheduled_at.isoformat(),
            },
            created_by=user,
        )
    if previous["status"] != appointment.status:
        InteractionLog.objects.create(
            contact=contact,
            kind=InteractionKind.APPOINTMENT,
            appointment=appointment,
            body=appointment.title,
            metadata={
                "event": appointment.status,
                "scheduled_at": appointment.scheduled_at.isoformat(),
            },
            created_by=user,
        )
        if appointment.status == AppointmentStatus.ATTENDED and contact.status != ContactStatus.ENROLLED:
            change_status(contact, ContactStatus.ATTENDED, user=user)
