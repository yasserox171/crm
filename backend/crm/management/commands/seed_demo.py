"""Creates realistic demo data, or removes it with --delete.

Demo contacts are tagged "Démo". Their phone numbers are random and may belong
to real people: delete the demo data before connecting WhatsApp.
"""

import random
from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from crm.models import (
    Appointment,
    AppointmentStatus,
    Contact,
    ContactSource,
    ContactStatus,
    ContentPost,
    DeliveryStatus,
    FollowUpAction,
    FollowUpRule,
    FollowUpTrigger,
    InteractionKind,
    InteractionLog,
    MediaType,
    MessagePurpose,
    PostStatus,
    SchoolLevel,
)

FIRST_NAMES = [
    "Yassine",
    "Salma",
    "Omar",
    "Khadija",
    "Ayoub",
    "Imane",
    "Hamza",
    "Fatima Zahra",
    "Mehdi",
    "Oumaima",
    "Anas",
    "Hajar",
    "Zakaria",
    "Nisrine",
    "Othmane",
    "Meryem",
    "Ilyas",
    "Sara",
    "Reda",
    "Chaimae",
    "Achraf",
    "Hiba",
    "Soufiane",
    "Wiam",
    "Adam",
    "Aya",
    "Badr",
    "Kawtar",
    "Ismail",
    "Douae",
]
LAST_NAMES = [
    "El Amrani",
    "Benali",
    "Ouazzani",
    "Bennani",
    "El Idrissi",
    "Tazi",
    "Alaoui",
    "Chraibi",
    "Berrada",
    "El Fassi",
    "Lahlou",
    "Naciri",
    "Sebti",
    "Kettani",
    "Bouzidi",
    "Raji",
    "Haddaoui",
    "Moussaoui",
]
SUBJECTS = ["Mathématiques", "Physique-Chimie", "SVT", "Français", "Anglais", "Informatique", "Comptabilité", "Arabe"]
CITIES = ["Safi"] * 8 + ["Youssoufia", "Jemaâ Shaim", "Sebt Gzoula"]
TAGS = ["Bac 2027", "Cours du soir", "Frères et sœurs", "Bourse", "Stage d'été", "Rappeler samedi"]
DEMO_TAG = "Démo"
DEMO_RULE_NAMES = [
    "Relance après absence de réponse",
    "Message de bienvenue",
    "Absent au rendez-vous",
    "Contacts inactifs",
]
DEMO_POSTS = [
    ("Rentrée : inscriptions ouvertes", PostStatus.PUBLISHED, -9, MediaType.IMAGE),
    ("Stage intensif Bac", PostStatus.PUBLISHED, -5, MediaType.TEXT),
    ("Témoignage d'une ancienne élève", PostStatus.SCHEDULED, 2, MediaType.VIDEO),
    ("Cours d'anglais pour adultes", PostStatus.SCHEDULED, 4, MediaType.IMAGE),
    ("Astuces de révision", PostStatus.DRAFT, 6, MediaType.TEXT),
    ("Portes ouvertes samedi", PostStatus.SCHEDULED, 9, MediaType.IMAGE),
    ("Résultats du test de niveau", PostStatus.DRAFT, None, MediaType.TEXT),
    ("Présentation de l'équipe", PostStatus.DRAFT, None, MediaType.VIDEO),
]


class Command(BaseCommand):
    help = "Creates demo contacts, appointments, interactions, rules and posts (--delete removes them)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Seed even if contacts already exist.")
        parser.add_argument("--delete", action="store_true", help="Delete the demo data instead.")

    @transaction.atomic
    def handle(self, *args, force=False, delete=False, **options):
        if delete:
            _, contacts = Contact.objects.filter(tags__contains=[DEMO_TAG]).delete()
            rules, _ = FollowUpRule.objects.filter(name__in=DEMO_RULE_NAMES).delete()
            posts, _ = ContentPost.objects.filter(title__in=[post[0] for post in DEMO_POSTS]).delete()
            self.stdout.write(
                self.style.SUCCESS(
                    f"Deleted {contacts.get('crm.Contact', 0)} demo contacts (with their history), "
                    f"{rules} rules and {posts} posts."
                )
            )
            return
        if Contact.objects.exists() and not force:
            raise CommandError("The database already has contacts; use --force to add demo data anyway.")
        rng = random.Random(42)
        now = timezone.now()
        today = timezone.localdate()

        contacts = []
        for _ in range(36):
            status = rng.choices(ContactStatus.values, weights=[6, 5, 4, 3, 4, 5])[0]
            contact = Contact.objects.create(
                first_name=rng.choice(FIRST_NAMES),
                last_name=rng.choice(LAST_NAMES),
                phone=f"0{rng.choice('67')}{rng.randint(10000000, 99999999)}",
                city=rng.choice(CITIES),
                subject=rng.choice(SUBJECTS),
                level=rng.choice(SchoolLevel.values[:7]),
                status=status,
                source=rng.choices(ContactSource.values, weights=[5, 4, 2, 2])[0],
                consent=rng.random() > 0.2,
                tags=[DEMO_TAG, *rng.sample(TAGS, k=rng.choice([0, 0, 1, 2]))],
                registered_at=today - timedelta(days=rng.randint(0, 90)),
            )
            created = timezone.make_aware(
                datetime.combine(contact.registered_at, time(rng.randint(9, 19), rng.randint(0, 59)))
            )
            Contact.objects.filter(pk=contact.pk).update(created_at=created, status_changed_at=created)
            InteractionLog.objects.create(
                contact=contact,
                kind=InteractionKind.STATUS_CHANGE,
                metadata={"event": "created", "from": None, "to": contact.status, "source": contact.source},
                created_at=created,
            )
            if rng.random() > 0.3:
                InteractionLog.objects.create(
                    contact=contact,
                    kind=InteractionKind.WHATSAPP_IN,
                    body=rng.choice(
                        [
                            "Bonjour, je voudrais des informations sur les cours de soutien.",
                            "السلام عليكم، بغيت نعرف الثمن ديال الدروس.",
                            "Est-ce qu'il reste des places pour le groupe du samedi ?",
                        ]
                    ),
                    created_at=created + timedelta(minutes=5),
                )
            if rng.random() > 0.5:
                InteractionLog.objects.create(
                    contact=contact,
                    kind=InteractionKind.NOTE,
                    body=rng.choice(
                        [
                            "Le père préfère être appelé après 18h.",
                            "Intéressée par le pack intensif avant les examens.",
                            "A demandé une réduction pour deux enfants.",
                        ]
                    ),
                    created_at=created + timedelta(hours=2),
                )
            contacts.append(contact)

        # Upcoming appointments over the next week, for the reminders screen.
        titles = ["Test de niveau", "Visite du centre", "Entretien d'orientation", "Inscription"]
        candidates = [c for c in contacts if c.status in (ContactStatus.APPOINTMENT_SET, ContactStatus.INTERESTED)]
        for index, contact in enumerate(candidates[:12]):
            day = today + timedelta(days=index % 7)
            hour = 10 + (index * 2) % 9
            scheduled = timezone.make_aware(datetime.combine(day, time(hour, 30 if index % 2 else 0)))
            if scheduled < now:
                scheduled += timedelta(days=1)
            appointment = Appointment.objects.create(contact=contact, title=rng.choice(titles), scheduled_at=scheduled)
            InteractionLog.objects.create(
                contact=contact,
                kind=InteractionKind.APPOINTMENT,
                appointment=appointment,
                body=appointment.title,
                metadata={"event": "created", "scheduled_at": scheduled.isoformat()},
            )
            if contact.status != ContactStatus.APPOINTMENT_SET:
                Contact.objects.filter(pk=contact.pk).update(status=ContactStatus.APPOINTMENT_SET)

        for contact in [c for c in contacts if c.status == ContactStatus.ATTENDED][:4]:
            past = now - timedelta(days=rng.randint(2, 10))
            appointment = Appointment.objects.create(
                contact=contact, title="Test de niveau", scheduled_at=past, status=AppointmentStatus.ATTENDED
            )
            InteractionLog.objects.create(
                contact=contact,
                kind=InteractionKind.WHATSAPP_OUT,
                purpose=MessagePurpose.REMINDER,
                appointment=appointment,
                body=f"Bonjour {contact.first_name}, nous vous rappelons votre rendez-vous au Centre Focus demain.",
                delivery_status=DeliveryStatus.SENT,
                sent_at=past - timedelta(days=1),
                created_at=past - timedelta(days=1),
            )

        FollowUpRule.objects.bulk_create(
            [
                FollowUpRule(
                    name="Relance après absence de réponse",
                    trigger=FollowUpTrigger.STATUS_IS,
                    trigger_status=ContactStatus.NO_ANSWER,
                    action=FollowUpAction.SEND_WHATSAPP,
                    message_template=(
                        "Bonjour {first_name}, nous avons essayé de vous joindre au sujet de votre demande. "
                        "Répondez à ce message pour fixer un rendez-vous au Centre Focus."
                    ),
                    delay_amount=2,
                    delay_unit="days",
                ),
                FollowUpRule(
                    name="Message de bienvenue",
                    trigger=FollowUpTrigger.CONTACT_CREATED,
                    action=FollowUpAction.SEND_WHATSAPP,
                    message_template="Bienvenue {first_name} ! Merci de votre intérêt pour le Centre Focus.",
                    delay_amount=10,
                    delay_unit="minutes",
                ),
                FollowUpRule(
                    name="Absent au rendez-vous",
                    trigger=FollowUpTrigger.APPOINTMENT_NO_SHOW,
                    action=FollowUpAction.CHANGE_STATUS,
                    action_status=ContactStatus.NO_ANSWER,
                    delay_amount=1,
                    delay_unit="days",
                ),
                FollowUpRule(
                    name="Contacts inactifs",
                    trigger=FollowUpTrigger.NO_INTERACTION,
                    action=FollowUpAction.ADD_TAG,
                    action_tag="À relancer",
                    delay_amount=14,
                    delay_unit="days",
                    is_active=False,
                ),
            ]
        )

        for title, status, offset, media_type in DEMO_POSTS:
            scheduled = None
            if offset is not None:
                scheduled = timezone.make_aware(datetime.combine(today + timedelta(days=offset), time(18, 0)))
            ContentPost.objects.create(
                title=title,
                body=f"{title} — plus d'informations au Centre Focus, Safi. Contactez-nous sur WhatsApp !",
                platforms=rng.choice([["facebook"], ["instagram"], ["facebook", "instagram"]]),
                media_type=media_type,
                status=status,
                scheduled_at=scheduled,
                published_at=scheduled if status == PostStatus.PUBLISHED else None,
            )

        self.stdout.write(self.style.SUCCESS(f"Demo data created: {len(contacts)} contacts."))
