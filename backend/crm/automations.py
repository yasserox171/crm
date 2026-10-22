"""Follow-up automation engine, run periodically by ``manage.py run_worker``.

Each active rule looks for trigger occurrences that happened after the rule was
activated and at least ``delay`` ago, then applies its action once per
occurrence (tracked with ``FollowUpExecution``).

Contacts excluded by the staff, from every rule (``Contact.automations_excluded``)
or from one rule (``FollowUpRule.excluded_contacts``), are skipped: their
occurrences are recorded as skipped, so re-including a contact never replays
what fell due while it was excluded.
"""

import logging
from collections.abc import Iterator
from datetime import datetime

from django.db import IntegrityError, transaction
from django.db.models import F, Max, Q, QuerySet
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from . import services
from .messaging import CANCELLED, queue_message, render_template
from .models import (
    Appointment,
    AppointmentStatus,
    AppSettings,
    Contact,
    ContactStatus,
    DeliveryStatus,
    FollowUpAction,
    FollowUpExecution,
    FollowUpRule,
    FollowUpTrigger,
    InteractionLog,
    MessagePurpose,
)

logger = logging.getLogger(__name__)

# contact, trigger ref (unique per occurrence), appointment, when the trigger happened
Occurrence = tuple[Contact, str, Appointment | None, datetime]


def run_automations(now: datetime | None = None) -> int:
    """Evaluate every active rule. Returns the number of actions applied."""
    now = now or timezone.now()
    app_settings = AppSettings.load()
    if app_settings.automations_paused:
        return 0
    total = 0
    for rule in FollowUpRule.objects.filter(is_active=True):
        applied = 0
        done = set(FollowUpExecution.objects.filter(rule=rule).values_list("contact_id", "trigger_ref"))
        excluded = _excluded_ids(rule)
        for contact, ref, appointment, _ in _occurrences(rule, now):
            if (contact.pk, ref) in done:
                continue
            if _execute(rule, contact, ref, appointment, app_settings.message_locale, excluded):
                applied += 1
        if applied:
            FollowUpRule.objects.filter(pk=rule.pk).update(last_run_at=now, run_count=F("run_count") + applied)
            logger.info("Rule %s applied %s time(s)", rule.pk, applied)
        total += applied
    return total


def _occurrences(rule: FollowUpRule, now: datetime, *, upcoming: bool = False) -> Iterator[Occurrence]:
    """Trigger occurrences since the rule was activated that are due (at least ``delay``
    old), or with ``upcoming`` the ones still waiting for their delay."""
    cutoff = now - rule.delay
    window = {"event_at__gt": cutoff} if upcoming else {"event_at__lte": cutoff}
    since = rule.activated_at
    if rule.trigger == FollowUpTrigger.CONTACT_CREATED:
        contacts = Contact.objects.annotate(event_at=F("created_at")).filter(event_at__gte=since, **window)
        for contact in contacts:
            yield contact, "created", None, contact.event_at

    elif rule.trigger == FollowUpTrigger.STATUS_IS:
        contacts = (
            Contact.objects.filter(status=rule.trigger_status)
            .annotate(event_at=F("status_changed_at"))
            .filter(event_at__gte=since, **window)
        )
        for contact in contacts:
            yield contact, f"status:{contact.event_at.isoformat()}", None, contact.event_at

    elif rule.trigger == FollowUpTrigger.APPOINTMENT_NO_SHOW:
        appointments = (
            Appointment.objects.select_related("contact")
            .filter(status=AppointmentStatus.NO_SHOW)
            .annotate(event_at=F("scheduled_at"))
            .filter(event_at__gte=since, **window)
        )
        for appointment in appointments:
            yield appointment.contact, f"appt:{appointment.pk}", appointment, appointment.event_at

    elif rule.trigger == FollowUpTrigger.NO_INTERACTION:
        # Messages sent by automations don't count as activity, so a contact is
        # nudged once per idle period instead of every `delay`.
        contacts = (
            Contact.objects.exclude(status=ContactStatus.ENROLLED)
            .annotate(
                event_at=Greatest(
                    Coalesce(Max("interactions__created_at", filter=Q(interactions__rule__isnull=True)), "created_at"),
                    "created_at",
                )
            )
            .filter(event_at__gte=since - rule.delay, **window)
        )
        for contact in contacts:
            yield contact, f"idle:{contact.event_at.isoformat()}", None, contact.event_at


def _excluded_ids(rule: FollowUpRule) -> set[int]:
    return set(rule.excluded_contacts.values_list("pk", flat=True))


def _planned(rule: FollowUpRule, now: datetime, excluded: set[int]) -> Iterator[tuple[Contact, datetime]]:
    """Occurrences still waiting for their delay that the action will really apply to."""
    done = set(FollowUpExecution.objects.filter(rule=rule).values_list("contact_id", "trigger_ref"))
    for contact, ref, _, event_at in _occurrences(rule, now, upcoming=True):
        if (contact.pk, ref) not in done and not _skip_reason(rule, contact, excluded):
            yield contact, event_at + rule.delay


def upcoming(now: datetime | None = None) -> list[dict]:
    """What the active rules will do next, grouped by contact, soonest first.

    Each item is ``{"contact": Contact, "actions": [{"rule": FollowUpRule, "due_at": datetime}]}``.
    Contacts the action would skip (excluded, no consent, nothing to change) are left out.
    """
    now = now or timezone.now()
    planned: dict[int, dict] = {}
    for rule in FollowUpRule.objects.filter(is_active=True):
        for contact, due_at in _planned(rule, now, _excluded_ids(rule)):
            entry = planned.setdefault(contact.pk, {"contact": contact, "actions": []})
            entry["actions"].append({"rule": rule, "due_at": due_at})
    for entry in planned.values():
        entry["actions"].sort(key=lambda action: action["due_at"])
    return sorted(planned.values(), key=lambda entry: entry["actions"][0]["due_at"])


def planned_for_rule(rule: FollowUpRule, now: datetime | None = None) -> dict[int, datetime]:
    """Soonest planned action of one rule per contact id, ignoring the rule's own exclusions
    (so the rule form can say what a ticked number would get)."""
    planned: dict[int, datetime] = {}
    for contact, due_at in _planned(rule, now or timezone.now(), excluded=set()):
        planned[contact.pk] = min(due_at, planned.get(contact.pk, due_at))
    return planned


def cancel_queued(rule: FollowUpRule, contact_ids: set[int]) -> int:
    """Cancel the rule's messages still waiting in the queue for these contacts."""
    return InteractionLog.objects.filter(
        rule=rule, contact_id__in=contact_ids, delivery_status=DeliveryStatus.PENDING
    ).update(delivery_status=DeliveryStatus.FAILED, error=CANCELLED)


def set_excluded(contacts: QuerySet[Contact], excluded: bool) -> tuple[int, int]:
    """Take contacts out of every automation (or bring them back).

    Excluding also cancels their automated messages still waiting in the queue.
    Returns ``(contacts changed, messages cancelled)``.
    """
    with transaction.atomic():
        changed = contacts.exclude(automations_excluded=excluded).update(
            automations_excluded=excluded, automations_excluded_at=timezone.now() if excluded else None
        )
        cancelled = 0
        if excluded:
            cancelled = InteractionLog.objects.filter(
                contact__in=contacts, rule__isnull=False, delivery_status=DeliveryStatus.PENDING
            ).update(delivery_status=DeliveryStatus.FAILED, error=CANCELLED)
    return changed, cancelled


def _execute(
    rule: FollowUpRule, contact: Contact, ref: str, appointment: Appointment | None, locale: str, excluded: set[int]
) -> bool:
    try:
        with transaction.atomic():
            execution = FollowUpExecution.objects.create(rule=rule, contact=contact, trigger_ref=ref)
            skipped_reason = _apply_action(rule, contact, appointment, locale, excluded)
            if skipped_reason:
                execution.outcome = FollowUpExecution.Outcome.SKIPPED
                execution.detail = skipped_reason
                execution.save(update_fields=["outcome", "detail"])
                return False
            return True
    except IntegrityError:
        # Another worker handled this occurrence concurrently.
        return False


def _skip_reason(rule: FollowUpRule, contact: Contact, excluded: set[int]) -> str:
    """Why the rule's action would do nothing for this contact ("" if it applies).
    ``excluded`` holds the ids of the contacts excluded from this rule."""
    if contact.automations_excluded or contact.pk in excluded:
        return "excluded"
    if rule.action == FollowUpAction.SEND_WHATSAPP and not contact.consent:
        return "no_consent"
    if rule.action == FollowUpAction.CHANGE_STATUS and contact.status == rule.action_status:
        return "unchanged"
    if rule.action == FollowUpAction.ADD_TAG and rule.action_tag.strip() in contact.tags:
        return "unchanged"
    return ""


def _apply_action(
    rule: FollowUpRule, contact: Contact, appointment: Appointment | None, locale: str, excluded: set[int]
) -> str:
    """Apply the rule's action. Returns a reason string when the action was skipped."""
    if reason := _skip_reason(rule, contact, excluded):
        return reason
    if rule.action == FollowUpAction.SEND_WHATSAPP:
        body = render_template(rule.message_template, contact, appointment, locale)
        queue_message(contact, body, purpose=MessagePurpose.AUTOMATION, rule=rule, appointment=appointment)
        return ""
    if rule.action == FollowUpAction.CHANGE_STATUS:
        return "" if services.change_status(contact, rule.action_status, rule=rule) else "unchanged"
    if rule.action == FollowUpAction.ADD_TAG:
        return "" if services.add_tag(contact, rule.action_tag) else "unchanged"
    return "unknown_action"
