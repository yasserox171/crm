from itertools import count

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from crm.models import Contact

_phones = count(10000000)


def make_user(email="staff@focus.ma", password="Sup3r-secret-pass"):
    return get_user_model().objects.create_user(email=email, password=password)


def make_contact(**overrides):
    data = {
        "first_name": "Salma",
        "last_name": "Bennani",
        "phone": f"06{next(_phones)}",
        "consent": True,
    }
    data.update(overrides)
    return Contact.objects.create(**data)


def auth_client(user=None):
    client = APIClient()
    client.force_authenticate(user or make_user())
    return client
