import tempfile
from datetime import datetime
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from crm.models import ContentPost

from .factories import auth_client


class ContentTests(APITestCase):
    def setUp(self):
        self.client = auth_client()

    def test_scheduled_post_requires_date(self):
        response = self.client.post(
            "/api/content/posts/", {"title": "Portes ouvertes", "status": "scheduled"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("scheduled_at", response.json())

    def test_month_filter_and_publish(self):
        october = timezone.make_aware(datetime(2026, 10, 15, 18))
        november = timezone.make_aware(datetime(2026, 11, 2, 18))
        ContentPost.objects.create(title="Octobre", status="scheduled", scheduled_at=october)
        ContentPost.objects.create(title="Novembre", status="scheduled", scheduled_at=november)
        ContentPost.objects.create(title="Sans date")

        posts = self.client.get("/api/content/posts/?month=2026-10").json()
        self.assertEqual([p["title"] for p in posts], ["Octobre"])
        self.assertEqual(self.client.get("/api/content/posts/").json()["count"], 3)

        post_id = posts[0]["id"]
        published = self.client.patch(f"/api/content/posts/{post_id}/", {"status": "published"}, format="json").json()
        self.assertIsNotNone(published["published_at"])

    def test_multipart_upload_with_platforms(self):
        media_root = tempfile.TemporaryDirectory()
        self.addCleanup(media_root.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=media_root.name))
        image = SimpleUploadedFile("affiche.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, content_type="image/png")
        response = self.client.post(
            "/api/content/posts/",
            {"title": "Affiche", "media_type": "image", "platforms": ["facebook", "instagram"], "media": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["platforms"], ["facebook", "instagram"])
        self.assertTrue(response.json()["media_url"].startswith("/media/content/"))

        video_as_image = SimpleUploadedFile("clip.mp4", b"0" * 64, content_type="video/mp4")
        response = self.client.post(
            "/api/content/posts/", {"title": "X", "media_type": "image", "media": video_as_image}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_generate_without_api_key(self):
        response = self.client.post("/api/content/posts/generate/", {"brief": "Portes ouvertes samedi"}, format="json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "ai_not_configured")

    @override_settings(ANTHROPIC_API_KEY="test-key")
    def test_generate_parses_structured_output(self):
        fake = mock.Mock(stop_reason="end_turn")
        fake.content = [
            mock.Mock(
                type="text", text='{"title": "Portes ouvertes", "body": "Venez samedi !", "hashtags": ["Safi", "#Bac"]}'
            )
        ]
        with mock.patch("crm.ai.anthropic.Anthropic") as client_cls:
            client_cls.return_value.beta.messages.create.return_value = fake
            response = self.client.post(
                "/api/content/posts/generate/",
                {"brief": "Portes ouvertes samedi", "language": "ar", "platform": "instagram"},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"title": "Portes ouvertes", "body": "Venez samedi !", "hashtags": ["#Safi", "#Bac"]}
        )
        kwargs = client_cls.return_value.beta.messages.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "claude-opus-5-5")
        self.assertEqual(kwargs["output_config"]["format"]["type"], "json_schema")
