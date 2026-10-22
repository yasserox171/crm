from datetime import datetime, timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from crm.messaging import MessagingError, dispatch_pending, render_template
from crm.models import Appointment, DeliveryStatus, InteractionLog

from .factories import auth_client, make_contact

TEMPLATE = "Bonjour {first_name}, RDV le {date} à {time} ({title}). {unknown}"


class ReminderTests(APITestCase):
    def setUp(self):
        self.client = auth_client()
        start = timezone.now() + timedelta(days=1)
        self.ok = Appointment.objects.create(contact=make_contact(first_name="Omar"), title="Test", scheduled_at=start)
        self.no_consent = Appointment.objects.create(
            contact=make_contact(first_name="Hiba", consent=False), scheduled_at=start + timedelta(hours=1)
        )

    def test_render_template_in_french(self):
        when = timezone.make_aware(datetime(2026, 10, 12, 14, 30))
        appointment = Appointment(contact=self.ok.contact, scheduled_at=when, title="Visite")
        body = render_template(TEMPLATE, self.ok.contact, appointment, "fr")
        self.assertEqual(body, "Bonjour Omar, RDV le lundi 12 octobre à 14:30 (Visite). {unknown}")

    def test_preview_flags_contacts_without_consent(self):
        response = self.client.post(
            "/api/reminders/preview/",
            {"appointment_ids": [self.ok.pk, self.no_consent.pk], "template": "Bonjour {first_name}"},
            format="json",
        )
        messages = response.json()["messages"]
        self.assertEqual(messages[0]["body"], "Bonjour Omar")
        self.assertIsNone(messages[0]["skipped_reason"])
        self.assertEqual(messages[1]["skipped_reason"], "no_consent")

    def test_send_queues_dispatches_and_reports_batch(self):
        response = self.client.post(
            "/api/reminders/send/",
            {
                "appointment_ids": [self.ok.pk, self.no_consent.pk],
                "template": "Bonjour {first_name}",
                "save_template": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["queued"], 1)
        self.assertEqual(data["skipped"], [{"appointment_id": self.no_consent.pk, "reason": "no_consent"}])
        self.assertEqual(self.client.get("/api/settings/").json()["reminder_template"], "Bonjour {first_name}")

        batch = self.client.get(f"/api/messages/batches/{data['batch_id']}/").json()
        self.assertEqual(batch["counts"], {"pending": 1, "sent": 0, "failed": 0})

        self.assertEqual(dispatch_pending(), 1)
        batch = self.client.get(f"/api/messages/batches/{data['batch_id']}/").json()
        self.assertEqual(batch["counts"]["sent"], 1)
        self.assertIsNotNone(batch["messages"][0]["sent_at"])
        self.ok.refresh_from_db()
        self.assertIsNotNone(self.ok.last_reminder_at)

    def test_failed_message_can_be_retried(self):
        self.client.post(
            "/api/reminders/send/", {"appointment_ids": [self.ok.pk], "template": "Bonjour"}, format="json"
        )
        with mock.patch("crm.messaging.ConsoleBackend.send", side_effect=MessagingError("HTTP 400: bad number")):
            dispatch_pending()
        message = InteractionLog.objects.get(appointment=self.ok)
        self.assertEqual(message.delivery_status, DeliveryStatus.FAILED)
        self.assertEqual(message.error, "HTTP 400: bad number")

        response = self.client.post(f"/api/messages/{message.pk}/retry/")
        self.assertEqual(response.json()["delivery_status"], "pending")
        dispatch_pending()
        message.refresh_from_db()
        self.assertEqual(message.delivery_status, DeliveryStatus.SENT)
        self.assertEqual(message.attempts, 2)


class BulkMessageTests(APITestCase):
    def setUp(self):
        self.client = auth_client()
        self.omar = make_contact(first_name="Omar", status="new")
        self.hiba = make_contact(first_name="Hiba", status="new", consent=False)
        self.sara = make_contact(first_name="Sara", status="enrolled")

    def test_preview_counts_and_personalises(self):
        response = self.client.post(
            "/api/messages/preview/",
            {"contact_ids": [self.omar.pk, self.hiba.pk]},
            format="json",
        )
        data = response.json()
        self.assertEqual((data["eligible"], data["no_consent"]), (1, 1))
        self.assertEqual(data["sample"]["first_name"], "Omar")
        self.assertEqual(data["sample"]["full_name"], self.omar.full_name)

    def test_send_to_explicit_selection(self):
        response = self.client.post(
            "/api/messages/send/",
            {"contact_ids": [self.omar.pk, self.hiba.pk, self.sara.pk], "body": "Bonjour {first_name}"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual((data["queued"], data["skipped_no_consent"]), (2, 1))
        self.assertEqual(dispatch_pending(), 2)
        batch = self.client.get(f"/api/messages/batches/{data['batch_id']}/").json()
        self.assertEqual(batch["counts"]["sent"], 2)
        self.assertEqual(sorted(m["body"] for m in batch["messages"]), ["Bonjour Omar", "Bonjour Sara"])
        log = InteractionLog.objects.get(contact=self.omar)
        self.assertEqual((log.purpose, log.kind), ("manual", "whatsapp_out"))

    def test_send_to_all_matching_filters(self):
        response = self.client.post(
            "/api/messages/send/", {"filters": {"status": "new"}, "body": "Salut {first_name}"}, format="json"
        )
        data = response.json()
        self.assertEqual((data["queued"], data["skipped_no_consent"]), (1, 1))
        self.assertEqual(InteractionLog.objects.get(batch_id=data["batch_id"]).contact, self.omar)

    def test_invalid_filter_is_rejected_not_widened(self):
        response = self.client.post(
            "/api/messages/send/", {"filters": {"status": "nope"}, "body": "Salut"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(InteractionLog.objects.filter(kind="whatsapp_out").exists())

    def test_requires_recipients_and_body(self):
        self.assertEqual(self.client.post("/api/messages/send/", {"body": "x"}, format="json").status_code, 400)
        response = self.client.post("/api/messages/send/", {"contact_ids": [self.omar.pk], "body": "  "}, format="json")
        self.assertEqual(response.status_code, 400)

    @override_settings(MAX_BULK_RECIPIENTS=1)
    def test_recipient_cap(self):
        response = self.client.post(
            "/api/messages/send/", {"contact_ids": [self.omar.pk, self.sara.pk], "body": "x"}, format="json"
        )
        self.assertEqual(response.json()["code"], "too_many_recipients")
        self.assertFalse(InteractionLog.objects.filter(kind="whatsapp_out").exists())


class WhatsAppCloudPayloadTests(APITestCase):
    @override_settings(
        MESSAGING_BACKEND="whatsapp_cloud",
        WHATSAPP_TOKEN="token",
        WHATSAPP_PHONE_NUMBER_ID="123",
        WHATSAPP_TEMPLATE_NAME="focus_message",
    )
    def test_template_parameter_has_no_line_breaks(self):
        from crm.messaging import get_backend

        response = mock.Mock(status_code=200)
        response.json.return_value = {"messages": [{"id": "wamid.1"}]}
        with mock.patch("crm.messaging.httpx.post", return_value=response) as post:
            external_id = get_backend().send("+212612345678", "Bonjour Omar,\n\nRDV   demain\tà 10:00.")
        self.assertEqual(external_id, "wamid.1")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["to"], "212612345678")
        self.assertEqual(payload["template"]["name"], "focus_message")
        text = payload["template"]["components"][0]["parameters"][0]["text"]
        self.assertEqual(text, "Bonjour Omar, RDV demain à 10:00.")


@override_settings(MESSAGING_BACKEND="manual")
class ManualModeTests(APITestCase):
    def setUp(self):
        self.client = auth_client()
        start = timezone.now() + timedelta(days=1)
        self.appointment = Appointment.objects.create(contact=make_contact(first_name="Omar"), scheduled_at=start)

    def _queue(self):
        response = self.client.post(
            "/api/messages/send/",
            {"contact_ids": [self.appointment.contact.pk], "body": "Bonjour {first_name}"},
            format="json",
        )
        return InteractionLog.objects.get(batch_id=response.json()["batch_id"])

    def test_worker_leaves_messages_in_the_outbox(self):
        message = self._queue()
        self.assertEqual(dispatch_pending(), 0)
        message.refresh_from_db()
        self.assertEqual(message.delivery_status, DeliveryStatus.PENDING)
        self.assertEqual(self.client.get("/api/settings/").json()["messaging_mode"], "manual")
        outbox = self.client.get("/api/messages/?delivery_status=pending").json()
        self.assertEqual([m["id"] for m in outbox["results"]], [message.pk])

    def test_mark_sent_then_undo(self):
        message = self._queue()
        message.appointment = self.appointment
        message.save()
        data = self.client.post(f"/api/messages/{message.pk}/mark-sent/").json()
        self.assertEqual((data["delivery_status"], data["sent_manually"]), ("sent", True))
        self.assertIsNotNone(data["sent_at"])
        self.appointment.refresh_from_db()
        self.assertIsNotNone(self.appointment.last_reminder_at)
        self.assertEqual(self.client.post(f"/api/messages/{message.pk}/mark-sent/").status_code, 400)

        data = self.client.post(f"/api/messages/{message.pk}/mark-pending/").json()
        self.assertEqual((data["delivery_status"], data["sent_at"]), ("pending", None))

    def test_cancel_removes_from_outbox(self):
        message = self._queue()
        data = self.client.post(f"/api/messages/{message.pk}/cancel/").json()
        self.assertEqual((data["delivery_status"], data["error"]), ("failed", "cancelled"))
        self.assertEqual(self.client.get("/api/messages/?delivery_status=pending").json()["count"], 0)

    def test_api_sent_messages_cannot_be_unmarked(self):
        message = self._queue()
        message.delivery_status = DeliveryStatus.SENT
        message.external_id = "wamid.123"
        message.save()
        self.assertEqual(self.client.post(f"/api/messages/{message.pk}/mark-pending/").status_code, 400)
