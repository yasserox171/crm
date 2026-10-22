from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from crm.models import Contact, ContactStatus, InteractionKind

from .factories import auth_client, make_contact, make_user


class AuthTests(APITestCase):
    def test_api_requires_login(self):
        self.assertEqual(APIClient().get("/api/contacts/").status_code, 403)

    def test_login_with_csrf_then_logout(self):
        make_user(email="staff@focus.ma", password="Sup3r-secret-pass")
        client = APIClient(enforce_csrf_checks=True)
        client.get("/api/auth/csrf/")
        token = client.cookies["csrftoken"].value

        bad = client.post(
            "/api/auth/login/", {"email": "staff@focus.ma", "password": "wrong"}, format="json", HTTP_X_CSRFTOKEN=token
        )
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["code"], "invalid_credentials")

        ok = client.post(
            "/api/auth/login/",
            {"email": "STAFF@focus.ma", "password": "Sup3r-secret-pass"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["email"], "staff@focus.ma")
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)

        token = client.cookies["csrftoken"].value  # rotated on login
        self.assertEqual(client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=token).status_code, 204)
        self.assertEqual(client.get("/api/auth/me/").status_code, 403)

    def test_login_rejects_missing_csrf(self):
        make_user()
        client = APIClient(enforce_csrf_checks=True)
        response = client.post("/api/auth/login/", {"email": "staff@focus.ma", "password": "x"}, format="json")
        self.assertEqual(response.status_code, 403)


class ContactApiTests(APITestCase):
    def setUp(self):
        self.client = auth_client()

    def test_create_normalizes_phone_and_logs_creation(self):
        response = self.client.post(
            "/api/contacts/",
            {
                "first_name": "Yassine",
                "last_name": "El Amrani",
                "phone": "06 12 34 56 78",
                "subject": "Mathématiques",
                "level": "bac_2",
                "source": "whatsapp",
                "consent": True,
                "tags": ["Bac 2027", "Bac 2027", "Soir"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["phone"], "+212612345678")
        self.assertEqual(data["phone_display"], "+212 612 345678")
        self.assertEqual(data["tags"], ["Bac 2027", "Soir"])
        self.assertIsNotNone(data["consent_at"])
        contact = Contact.objects.get(pk=data["id"])
        self.assertEqual(contact.interactions.get().metadata["event"], "created")

    def test_rejects_invalid_phone(self):
        response = self.client.post("/api/contacts/", {"first_name": "A", "phone": "12345"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.json())

    def test_filters_and_search(self):
        make_contact(first_name="Omar", last_name="Tazi", phone="0611111111", status=ContactStatus.NEW, source="ad")
        make_contact(
            first_name="Imane", last_name="Alaoui", phone="0622222222", status=ContactStatus.ENROLLED, source="paper"
        )
        make_contact(first_name="Hamza", last_name="Tazi", phone="0633333333", status=ContactStatus.NEW, source="paper")

        def names(query):
            return sorted(c["first_name"] for c in self.client.get(f"/api/contacts/?{query}").json()["results"])

        self.assertEqual(names("status=new"), ["Hamza", "Omar"])
        self.assertEqual(names("source=paper"), ["Hamza", "Imane"])
        self.assertEqual(names("search=tazi"), ["Hamza", "Omar"])
        self.assertEqual(names("search=omar%20tazi"), ["Omar"])
        self.assertEqual(names("search=06%2022"), ["Imane"])
        self.assertEqual(names("phone=%2B212633333333"), ["Hamza"])

        stats = self.client.get("/api/contacts/stats/?status=enrolled&source=paper").json()
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["by_status"]["new"], 1)
        self.assertEqual(stats["by_status"]["enrolled"], 1)

    def test_status_change_is_logged_in_timeline(self):
        contact = make_contact()
        response = self.client.patch(f"/api/contacts/{contact.pk}/", {"status": "interested"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.client.post(f"/api/contacts/{contact.pk}/notes/", {"body": "Rappeler après 18h"}, format="json")
        timeline = self.client.get(f"/api/contacts/{contact.pk}/timeline/").json()
        self.assertEqual([item["kind"] for item in timeline], [InteractionKind.NOTE, InteractionKind.STATUS_CHANGE])
        self.assertEqual(timeline[1]["metadata"], {"from": "new", "to": "interested"})

    def test_appointment_moves_contact_forward(self):
        contact = make_contact(status=ContactStatus.INTERESTED)
        response = self.client.post(
            "/api/appointments/",
            {
                "contact": contact.pk,
                "title": "Test de niveau",
                "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        contact.refresh_from_db()
        self.assertEqual(contact.status, ContactStatus.APPOINTMENT_SET)

        detail = self.client.get(f"/api/contacts/{contact.pk}/").json()
        self.assertEqual(detail["next_appointment"]["id"], response.json()["id"])

        self.client.patch(f"/api/appointments/{response.json()['id']}/", {"status": "attended"}, format="json")
        contact.refresh_from_db()
        self.assertEqual(contact.status, ContactStatus.ATTENDED)

    def test_rejects_appointment_in_the_past(self):
        contact = make_contact()
        response = self.client.post(
            "/api/appointments/",
            {"contact": contact.pk, "scheduled_at": (timezone.now() - timedelta(hours=1)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
