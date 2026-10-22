from datetime import timedelta
from unittest import mock

import httpx
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from crm.messaging import dispatch_pending
from crm.models import DeliveryStatus, InteractionKind, InteractionLog

from .factories import auth_client, make_contact

WEB = {
    "MESSAGING_BACKEND": "whatsapp_web",
    "WHATSAPP_GATEWAY_URL": "http://gateway",
    "WHATSAPP_GATEWAY_TOKEN": "secret",
    "WA_WEB_DAILY_LIMIT": 2,
}


def fake_gateway(state="connected", send_status=200, send_error=None, send_exc=None):
    """Stands in for httpx.request against the internal WhatsApp service."""

    def handler(method, url, json=None, headers=None, timeout=None):
        assert headers == {"X-Gateway-Token": "secret"}
        if url.endswith("/status"):
            return httpx.Response(
                200, json={"state": state, "qr": None, "me": {"phone": "212600000000", "name": "Focus"}}
            )
        if url.endswith("/send"):
            if send_exc:
                raise send_exc
            body = {"id": "true_212612345678@c.us_ABC"} if send_status == 200 else {"error": send_error}
            return httpx.Response(send_status, json=body)
        return httpx.Response(200, json={"ok": True})

    return mock.patch("crm.messaging.httpx.request", side_effect=handler)


@override_settings(**WEB)
class WhatsAppWebSendingTests(APITestCase):
    def setUp(self):
        self.client = auth_client()
        self.omar = make_contact(first_name="Omar")
        self.sara = make_contact(first_name="Sara")

    def _queue(self, *contacts):
        self.client.post(
            "/api/messages/send/",
            {"contact_ids": [c.pk for c in contacts], "body": "Bonjour {first_name}"},
            format="json",
        )
        return InteractionLog.objects.filter(kind=InteractionKind.WHATSAPP_OUT).order_by("id")

    def test_messages_wait_while_whatsapp_is_not_linked(self):
        messages = self._queue(self.omar)
        with fake_gateway(state="qr"):
            self.assertEqual(dispatch_pending(), 0)
        self.assertEqual(messages.get().delivery_status, DeliveryStatus.PENDING)

    def test_sends_one_message_per_call(self):
        messages = self._queue(self.omar, self.sara)
        with fake_gateway():
            self.assertEqual(dispatch_pending(), 1)
        first, second = messages
        self.assertEqual(first.delivery_status, DeliveryStatus.SENT)
        self.assertEqual(first.external_id, "waweb:true_212612345678@c.us_ABC")
        self.assertEqual(second.delivery_status, DeliveryStatus.PENDING)

    def test_daily_limit_holds_the_rest_until_tomorrow(self):
        self._queue(self.omar, self.sara, make_contact(first_name="Hiba"))
        with fake_gateway():
            self.assertEqual(dispatch_pending(), 1)
            self.assertEqual(dispatch_pending(), 1)
            self.assertEqual(dispatch_pending(), 0)  # limit (2) reached
        self.assertEqual(InteractionLog.objects.filter(delivery_status=DeliveryStatus.PENDING).count(), 1)
        # Yesterday's sends don't count against today.
        InteractionLog.objects.filter(delivery_status=DeliveryStatus.SENT).update(
            sent_at=timezone.now() - timedelta(days=1)
        )
        with fake_gateway():
            self.assertEqual(dispatch_pending(), 1)

    def test_number_without_whatsapp_fails(self):
        messages = self._queue(self.omar)
        with fake_gateway(send_status=422, send_error="not_on_whatsapp"):
            dispatch_pending()
        message = messages.get()
        self.assertEqual((message.delivery_status, message.error), (DeliveryStatus.FAILED, "not_on_whatsapp"))

    def test_service_down_mid_send_keeps_the_message_queued(self):
        messages = self._queue(self.omar)
        with fake_gateway(send_exc=httpx.ConnectError("down")):
            self.assertEqual(dispatch_pending(), 0)
        message = messages.get()
        self.assertEqual((message.delivery_status, message.attempts), (DeliveryStatus.PENDING, 0))

    def test_status_endpoint_reports_usage(self):
        with fake_gateway():
            data = self.client.get("/api/whatsapp/status/").json()
        self.assertEqual(
            (data["enabled"], data["state"], data["sent_today"], data["daily_limit"]), (True, "connected", 0, 2)
        )
        self.assertEqual(self.client.get("/api/settings/").json()["messaging_mode"], "web")
        with mock.patch("crm.messaging.httpx.request", side_effect=httpx.ConnectError("down")):
            self.assertEqual(self.client.get("/api/whatsapp/status/").json()["state"], "unreachable")


@override_settings(**WEB)
class WhatsAppIncomingTests(APITestCase):
    def setUp(self):
        self.gateway = APIClient()
        self.omar = make_contact(first_name="Omar", phone="0612345678")

    def _post(self, payload, token="secret"):
        return self.gateway.post("/api/whatsapp/incoming/", payload, format="json", HTTP_X_GATEWAY_TOKEN=token)

    def test_reply_from_a_contact_is_logged_once(self):
        payload = {"phone": "212612345678", "body": "Oui, je serai là samedi", "id": "msg-1", "timestamp": 1760000000}
        self.assertEqual(self._post(payload).json(), {"recorded": 1})
        self.assertEqual(self._post(payload).json(), {"recorded": 0})  # duplicate delivery
        log = self.omar.interactions.get(kind=InteractionKind.WHATSAPP_IN)
        self.assertEqual(log.body, "Oui, je serai là samedi")
        self.assertEqual(int(log.created_at.timestamp()), 1760000000)

    def test_unknown_numbers_are_ignored(self):
        self.assertEqual(self._post({"phone": "212699999999", "body": "Salut", "id": "x"}).json(), {"recorded": 0})
        self.assertEqual(self._post({"phone": "33612345678", "body": "Hi", "id": "y"}).json(), {"recorded": 0})
        self.assertFalse(InteractionLog.objects.filter(kind=InteractionKind.WHATSAPP_IN).exists())

    def test_requires_the_gateway_token(self):
        self.assertEqual(self._post({"phone": "212612345678", "body": "x"}, token="wrong").status_code, 403)


def fake_inbox(chats=None, messages=None, send_phone="212612345678"):
    def handler(method, url, json=None, headers=None, timeout=None):
        if url.endswith("/chats?limit=100"):
            return httpx.Response(200, json={"chats": chats or []})
        if "/messages" in url:
            return httpx.Response(200, json={"messages": messages or []})
        if url.endswith("/send"):
            assert "%40lid" in url  # chat id is URL-encoded
            return httpx.Response(200, json={"id": "true_x_ABC", "phone": send_phone})
        return httpx.Response(404, json={"error": "not_found"})

    return mock.patch("crm.messaging.httpx.request", side_effect=handler)


@override_settings(**WEB)
class WhatsAppInboxTests(APITestCase):
    def setUp(self):
        self.client = auth_client()
        self.omar = make_contact(first_name="Omar", phone="0612345678")

    def test_chats_are_matched_to_contacts(self):
        chats = [
            {"id": "111@lid", "name": "Omar", "phone": "212612345678", "unread": 2, "t": 1, "last": None},
            {"id": "222@lid", "name": "Inconnu", "phone": "212699999999", "unread": 0, "t": 2, "last": None},
            {"id": "333@lid", "name": "Sans numéro", "phone": None, "unread": 0, "t": 3, "last": None},
        ]
        with fake_inbox(chats=chats):
            data = self.client.get("/api/whatsapp/chats/").json()["chats"]
        self.assertEqual(data[0]["contact"], {"id": self.omar.pk, "full_name": self.omar.full_name, "status": "new"})
        self.assertIsNone(data[1]["contact"])
        self.assertIsNone(data[2]["contact"])

    def test_messages_and_invalid_chat_ids(self):
        with fake_inbox(messages=[{"id": "m1", "fromMe": False, "body": "Salut", "type": "chat", "t": 1, "ack": 1}]):
            response = self.client.get("/api/whatsapp/chats/111@lid/messages/")
        self.assertEqual(response.json()["messages"][0]["body"], "Salut")
        self.assertEqual(self.client.get("/api/whatsapp/chats/123-456@g.us/messages/").status_code, 400)

    def test_reply_is_logged_for_a_known_contact_only(self):
        with fake_inbox():
            response = self.client.post("/api/whatsapp/chats/111@lid/reply/", {"body": "Bonjour Omar"}, format="json")
        self.assertEqual(response.json(), {"id": "true_x_ABC", "logged": 1})
        log = self.omar.interactions.get(kind=InteractionKind.WHATSAPP_OUT)
        self.assertEqual((log.body, log.delivery_status, log.external_id), ("Bonjour Omar", "sent", "waweb:true_x_ABC"))

        with fake_inbox(send_phone="212699999999"):
            response = self.client.post("/api/whatsapp/chats/222@lid/reply/", {"body": "Bonjour"}, format="json")
        self.assertEqual(response.json()["logged"], 0)
        self.assertEqual(InteractionLog.objects.filter(kind=InteractionKind.WHATSAPP_OUT).count(), 1)

    def test_reply_ceiling_and_empty_body(self):
        self.assertEqual(
            self.client.post("/api/whatsapp/chats/111@lid/reply/", {"body": "  "}, format="json").status_code, 400
        )
        for _ in range(4):  # limit is 2 in WEB: replies stop at twice the limit
            InteractionLog.objects.create(
                contact=self.omar,
                kind=InteractionKind.WHATSAPP_OUT,
                delivery_status=DeliveryStatus.SENT,
                sent_at=timezone.now(),
                external_id="waweb:x",
            )
        response = self.client.post("/api/whatsapp/chats/111@lid/reply/", {"body": "Encore"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (429, "daily_limit"))

    def test_service_down_and_authentication(self):
        with mock.patch("crm.messaging.httpx.request", side_effect=httpx.ConnectError("down")):
            response = self.client.get("/api/whatsapp/chats/")
        self.assertEqual((response.status_code, response.json()["code"]), (503, "unreachable"))
        self.assertEqual(APIClient().get("/api/whatsapp/chats/").status_code, 403)
