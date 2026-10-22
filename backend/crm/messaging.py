"""Outgoing WhatsApp messages.

Messages are queued as ``InteractionLog`` rows (``delivery_status=pending``) and
sent by the worker process, so the UI can show pending / sent / failed states.
"""

import logging
import re
import uuid
from urllib.parse import quote

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import formats, timezone, translation

from .models import (
    Appointment,
    Contact,
    DeliveryStatus,
    FollowUpRule,
    InteractionKind,
    InteractionLog,
)

logger = logging.getLogger(__name__)

TEMPLATE_VARIABLES = ("first_name", "last_name", "full_name", "date", "time", "title")
_PLACEHOLDER = re.compile(r"\{(" + "|".join(TEMPLATE_VARIABLES) + r")\}")


class MessagingError(Exception):
    pass


class GatewayNotReady(MessagingError):
    """WhatsApp isn't linked or the gateway is down: the message stays queued."""


class GatewayError(MessagingError):
    """The WhatsApp service answered with an error (e.g. chat not found)."""

    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def render_template(template: str, contact: Contact, appointment: Appointment | None = None, locale: str = "fr") -> str:
    """Replace the known {placeholders}; any other braces are left untouched."""
    values = {
        "first_name": contact.first_name,
        "last_name": contact.last_name,
        "full_name": contact.full_name,
        "date": "",
        "time": "",
        "title": "",
    }
    if appointment is not None:
        local = timezone.localtime(appointment.scheduled_at)
        with translation.override(locale):
            values["date"] = formats.date_format(local, "l j F")
        values["time"] = local.strftime("%H:%M")
        values["title"] = appointment.title
    return _PLACEHOLDER.sub(lambda match: values[match.group(1)], template).strip()


def template_param(text: str) -> str:
    """Meta rejects template parameters containing line breaks, tabs or 4+ consecutive spaces."""
    return re.sub(r"\s+", " ", text).strip()


class ConsoleBackend:
    """Development backend: logs the message instead of sending it."""

    def send(self, phone: str, body: str) -> str:
        logger.info("[console WhatsApp] to %s: %s", phone, body)
        return f"console-{uuid.uuid4().hex[:12]}"


class WhatsAppCloudBackend:
    """Meta WhatsApp Business Cloud API."""

    def __init__(self):
        if not settings.WHATSAPP_TOKEN or not settings.WHATSAPP_PHONE_NUMBER_ID:
            raise MessagingError("WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured.")
        self.url = (
            f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
        )

    def send(self, phone: str, body: str) -> str:
        payload = {"messaging_product": "whatsapp", "to": phone.lstrip("+")}
        if settings.WHATSAPP_TEMPLATE_NAME:
            payload |= {
                "type": "template",
                "template": {
                    "name": settings.WHATSAPP_TEMPLATE_NAME,
                    "language": {"code": settings.WHATSAPP_TEMPLATE_LANG},
                    "components": [{"type": "body", "parameters": [{"type": "text", "text": template_param(body)}]}],
                },
            }
        else:
            payload |= {"type": "text", "text": {"body": body, "preview_url": False}}
        try:
            response = httpx.post(
                self.url,
                json=payload,
                headers={"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"},
                timeout=15,
            )
        except httpx.HTTPError as exc:
            raise MessagingError(f"Network error: {exc}") from exc
        if response.status_code >= 400:
            try:
                detail = response.json().get("error", {}).get("message", "")
            except ValueError:
                detail = response.text
            raise MessagingError(f"HTTP {response.status_code}: {detail}"[:250])
        messages = response.json().get("messages") or [{}]
        return messages[0].get("id", "")


# external_id prefix of messages sent through the linked WhatsApp account.
WEB_PREFIX = "waweb:"


class WhatsAppWebGateway:
    """The `whatsapp` service: a WhatsApp account linked by QR code (unofficial, rate-limited)."""

    def _request(self, method: str, path: str, payload: dict | None = None, timeout: float = 30) -> httpx.Response:
        try:
            return httpx.request(
                method,
                f"{settings.WHATSAPP_GATEWAY_URL}{path}",
                json=payload,
                headers={"X-Gateway-Token": settings.WHATSAPP_GATEWAY_TOKEN},
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            raise GatewayNotReady(f"gateway_unreachable: {exc}") from exc

    def status(self) -> dict:
        response = self._request("GET", "/status", timeout=5)
        if response.status_code != 200:
            raise GatewayNotReady(f"gateway_status_{response.status_code}")
        return response.json()

    def send(self, phone: str, body: str) -> str:
        response = self._request("POST", "/send", {"phone": phone.lstrip("+"), "text": body}, timeout=60)
        if response.status_code == 200:
            return f"{WEB_PREFIX}{response.json().get('id', '')}"
        error = response.json().get("error", "") if response.content else ""
        if response.status_code == 409:
            raise GatewayNotReady(error or "not_connected")
        if response.status_code == 422:
            raise MessagingError(error or "not_on_whatsapp")
        raise MessagingError(f"gateway_error: HTTP {response.status_code} {error}"[:250])

    def logout(self) -> None:
        self._request("POST", "/logout", timeout=30)

    # --- Inbox (read live from WhatsApp Web, never stored) ---

    def _json(self, response: httpx.Response) -> dict:
        data = response.json() if response.content else {}
        if response.status_code == 200:
            return data
        error = data.get("error", "")
        if response.status_code == 409:
            raise GatewayNotReady(error or "not_connected")
        raise GatewayError(response.status_code, error or "gateway_error")

    def chats(self, limit: int = 50) -> list[dict]:
        return self._json(self._request("GET", f"/chats?limit={limit}", timeout=60))["chats"]

    def messages(self, chat_id: str, limit: int = 50) -> list[dict]:
        return self._json(self._request("GET", f"/chats/{quote(chat_id, safe='')}/messages?limit={limit}", timeout=60))[
            "messages"
        ]

    def reply(self, chat_id: str, text: str) -> dict:
        return self._json(self._request("POST", f"/chats/{quote(chat_id, safe='')}/send", {"text": text}, timeout=60))


def is_web_mode() -> bool:
    return settings.MESSAGING_BACKEND == "whatsapp_web"


def web_sent_today() -> int:
    """Messages sent today (local time) through the linked account — counted against the daily limit."""
    start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    return InteractionLog.objects.filter(
        kind=InteractionKind.WHATSAPP_OUT,
        delivery_status=DeliveryStatus.SENT,
        sent_at__gte=start,
        external_id__startswith=WEB_PREFIX,
    ).count()


def get_backend():
    if settings.MESSAGING_BACKEND == "whatsapp_cloud":
        return WhatsAppCloudBackend()
    if settings.MESSAGING_BACKEND == "whatsapp_web":
        return WhatsAppWebGateway()
    return ConsoleBackend()


def queue_message(
    contact: Contact,
    body: str,
    *,
    purpose: str,
    batch_id: uuid.UUID | None = None,
    appointment: Appointment | None = None,
    rule=None,
    user=None,
) -> InteractionLog:
    return InteractionLog.objects.create(
        contact=contact,
        kind=InteractionKind.WHATSAPP_OUT,
        body=body,
        purpose=purpose,
        delivery_status=DeliveryStatus.PENDING,
        send_after=timezone.now(),
        batch_id=batch_id,
        appointment=appointment,
        rule=rule,
        created_by=user,
    )


# external_id of messages the staff sent themselves from WhatsApp (manual mode).
MANUAL_MARKER = "manual"
# error value of messages the staff chose not to send.
CANCELLED = "cancelled"


def is_manual_mode() -> bool:
    """No WhatsApp API: each message is opened in WhatsApp and sent by the staff member."""
    return settings.MESSAGING_BACKEND == "manual"


def _excluded_from_rule(message: InteractionLog) -> bool:
    if message.contact.automations_excluded:
        return True
    exclusions = FollowUpRule.excluded_contacts.through.objects
    return exclusions.filter(followuprule_id=message.rule_id, contact_id=message.contact_id).exists()


def dispatch_pending(limit: int = 50) -> int:
    """Send queued messages. Safe to run from several workers (rows are locked)."""
    if is_manual_mode():
        return 0  # pending messages wait in the outbox until sent from WhatsApp
    backend = None
    if is_web_mode():
        # Linked account: one message per call (the worker spaces them out), within the
        # daily limit, and only while the account is connected — otherwise they wait.
        due = InteractionLog.objects.filter(delivery_status=DeliveryStatus.PENDING, send_after__lte=timezone.now())
        if not due.exists() or web_sent_today() >= settings.WA_WEB_DAILY_LIMIT:
            return 0
        backend = WhatsAppWebGateway()
        try:
            if backend.status().get("state") != "connected":
                return 0
        except GatewayNotReady:
            return 0
        limit = 1
    processed = 0
    while processed < limit:
        with transaction.atomic():
            message = (
                InteractionLog.objects.select_for_update(skip_locked=True, of=("self",))
                .select_related("contact", "appointment")
                .filter(delivery_status=DeliveryStatus.PENDING, send_after__lte=timezone.now())
                .order_by("send_after", "id")
                .first()
            )
            if message is None:
                break
            if message.rule_id and _excluded_from_rule(message):
                # Queued by an automation just before the contact was excluded.
                message.delivery_status = DeliveryStatus.FAILED
                message.error = CANCELLED
                message.save(update_fields=["delivery_status", "error"])
                continue
            message.attempts += 1
            try:
                backend = backend or get_backend()
                message.external_id = backend.send(message.contact.phone, message.body)
            except GatewayNotReady as exc:
                # Not the message's fault: leave it queued (nothing saved) and stop for now.
                logger.info("WhatsApp gateway not ready, message %s stays queued: %s", message.pk, exc)
                break
            except MessagingError as exc:
                message.delivery_status = DeliveryStatus.FAILED
                message.error = str(exc)[:255]
                logger.warning("WhatsApp message %s failed: %s", message.pk, exc)
            except Exception as exc:  # never let one message stop the queue
                message.delivery_status = DeliveryStatus.FAILED
                message.error = f"Unexpected error: {exc}"[:255]
                logger.exception("WhatsApp message %s crashed", message.pk)
            else:
                message.delivery_status = DeliveryStatus.SENT
                message.sent_at = timezone.now()
                message.error = ""
                if message.appointment_id:
                    Appointment.objects.filter(pk=message.appointment_id).update(last_reminder_at=message.sent_at)
            message.save(update_fields=["attempts", "external_id", "delivery_status", "error", "sent_at"])
            processed += 1
    return processed


def mark_sent_manually(message: InteractionLog) -> InteractionLog:
    message.delivery_status = DeliveryStatus.SENT
    message.sent_at = timezone.now()
    message.external_id = MANUAL_MARKER
    message.error = ""
    message.save(update_fields=["delivery_status", "sent_at", "external_id", "error"])
    if message.appointment_id:
        Appointment.objects.filter(pk=message.appointment_id).update(last_reminder_at=message.sent_at)
    return message


def unmark_sent(message: InteractionLog) -> InteractionLog:
    message.delivery_status = DeliveryStatus.PENDING
    message.sent_at = None
    message.external_id = ""
    message.save(update_fields=["delivery_status", "sent_at", "external_id"])
    return message


def cancel_message(message: InteractionLog) -> InteractionLog:
    message.delivery_status = DeliveryStatus.FAILED
    message.error = CANCELLED
    message.save(update_fields=["delivery_status", "error"])
    return message


def retry_message(message: InteractionLog) -> InteractionLog:
    message.delivery_status = DeliveryStatus.PENDING
    message.send_after = timezone.now()
    message.error = ""
    message.save(update_fields=["delivery_status", "send_after", "error"])
    return message
