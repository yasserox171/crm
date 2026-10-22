import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone

from .phone import InvalidPhoneNumber, format_phone, normalize_phone


class ContactStatus(models.TextChoices):
    NEW = "new", "Nouveau"
    INTERESTED = "interested", "Intéressé"
    APPOINTMENT_SET = "appointment_set", "RDV fixé"
    ATTENDED = "attended", "Venu au RDV"
    NO_ANSWER = "no_answer", "Pas de réponse"
    ENROLLED = "enrolled", "Inscrit"


class ContactSource(models.TextChoices):
    AD = "ad", "Publicité"
    WHATSAPP = "whatsapp", "WhatsApp"
    PAPER = "paper", "Formulaire papier"
    LEGACY = "legacy", "Anciennes données"


class SchoolLevel(models.TextChoices):
    PRIMARY = "primary", "Primaire"
    MIDDLE = "middle", "Collège"
    COMMON_CORE = "common_core", "Tronc commun"
    BAC_1 = "bac_1", "1re année Bac"
    BAC_2 = "bac_2", "2e année Bac"
    HIGHER = "higher", "Études supérieures"
    ADULT = "adult", "Adulte / professionnel"
    OTHER = "other", "Autre"


def validate_phone(value):
    try:
        normalize_phone(value)
    except InvalidPhoneNumber:
        raise ValidationError("Numéro marocain invalide (ex. 06 12 34 56 78).", code="invalid_phone") from None


class Contact(models.Model):
    first_name = models.CharField("prénom", max_length=100)
    last_name = models.CharField("nom", max_length=100, blank=True)
    phone = models.CharField("téléphone", max_length=16, validators=[validate_phone], db_index=True)
    city = models.CharField("ville", max_length=100, default="Safi", blank=True)
    subject = models.CharField("matière", max_length=120, blank=True)
    level = models.CharField("niveau scolaire", max_length=20, choices=SchoolLevel.choices, blank=True)
    status = models.CharField(max_length=20, choices=ContactStatus.choices, default=ContactStatus.NEW, db_index=True)
    status_changed_at = models.DateTimeField(default=timezone.now)
    source = models.CharField(max_length=20, choices=ContactSource.choices, default=ContactSource.AD, db_index=True)
    consent = models.BooleanField("consentement WhatsApp", default=False)
    consent_at = models.DateTimeField(null=True, blank=True)
    # Taken out of every automation by the staff (manual messages still go through).
    automations_excluded = models.BooleanField("exclu des automatisations", default=False)
    automations_excluded_at = models.DateTimeField(null=True, blank=True)
    tags = models.JSONField(default=list, blank=True)
    registered_at = models.DateField("date d'inscription", default=timezone.localdate)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-registered_at", "-created_at"]

    def __str__(self):
        return f"{self.full_name} ({self.phone_display})"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._loaded_status = instance.__dict__.get("status")
        instance._loaded_consent = instance.__dict__.get("consent")
        return instance

    def save(self, *args, **kwargs):
        self.phone = normalize_phone(self.phone)
        now = timezone.now()
        loaded_status = getattr(self, "_loaded_status", None)
        if self._state.adding or (loaded_status is not None and self.status != loaded_status):
            self.status_changed_at = now
        if self.consent and (self._state.adding or not getattr(self, "_loaded_consent", False)):
            self.consent_at = self.consent_at or now
        if not self.consent:
            self.consent_at = None
        super().save(*args, **kwargs)
        self._loaded_status = self.status
        self._loaded_consent = self.consent

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def phone_display(self):
        return format_phone(self.phone)


class AppointmentStatus(models.TextChoices):
    SCHEDULED = "scheduled", "Prévu"
    ATTENDED = "attended", "Venu"
    NO_SHOW = "no_show", "Absent"
    CANCELLED = "cancelled", "Annulé"


class Appointment(models.Model):
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="appointments")
    title = models.CharField("objet", max_length=150, blank=True)
    scheduled_at = models.DateTimeField("date et heure", db_index=True)
    duration_minutes = models.PositiveSmallIntegerField(default=30)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=AppointmentStatus.choices, default=AppointmentStatus.SCHEDULED)
    last_reminder_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_at"]

    def __str__(self):
        return f"{self.contact.full_name} — {timezone.localtime(self.scheduled_at):%d/%m/%Y %H:%M}"


class InteractionKind(models.TextChoices):
    WHATSAPP_OUT = "whatsapp_out", "WhatsApp envoyé"
    WHATSAPP_IN = "whatsapp_in", "WhatsApp reçu"
    CALL = "call", "Appel"
    APPOINTMENT = "appointment", "Rendez-vous"
    NOTE = "note", "Note"
    STATUS_CHANGE = "status_change", "Changement de statut"


class DeliveryStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    SENT = "sent", "Envoyé"
    FAILED = "failed", "Échec"


class MessagePurpose(models.TextChoices):
    REMINDER = "reminder", "Rappel de RDV"
    AUTOMATION = "automation", "Automatisation"
    MANUAL = "manual", "Manuel"


class InteractionLog(models.Model):
    """One entry in a contact's timeline.

    Outgoing WhatsApp messages double as the send queue: they are created with
    ``delivery_status=pending`` and the worker (``manage.py run_worker``) sends
    them and records ``sent`` / ``failed``.
    """

    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="interactions")
    kind = models.CharField(max_length=20, choices=InteractionKind.choices)
    body = models.TextField(blank=True)
    purpose = models.CharField(max_length=20, choices=MessagePurpose.choices, blank=True)
    delivery_status = models.CharField(max_length=10, choices=DeliveryStatus.choices, null=True, blank=True)
    send_after = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.CharField(max_length=255, blank=True)
    external_id = models.CharField(max_length=128, blank=True)
    batch_id = models.UUIDField(null=True, blank=True, db_index=True)
    appointment = models.ForeignKey(
        Appointment, null=True, blank=True, on_delete=models.SET_NULL, related_name="interactions"
    )
    rule = models.ForeignKey(
        "FollowUpRule", null=True, blank=True, on_delete=models.SET_NULL, related_name="interactions"
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["delivery_status", "send_after"])]

    def __str__(self):
        return f"{self.get_kind_display()} — {self.contact.full_name}"


class FollowUpTrigger(models.TextChoices):
    CONTACT_CREATED = "contact_created", "Nouveau contact"
    STATUS_IS = "status_is", "Statut inchangé"
    APPOINTMENT_NO_SHOW = "appointment_no_show", "Absent au RDV"
    NO_INTERACTION = "no_interaction", "Aucune interaction"


class FollowUpAction(models.TextChoices):
    SEND_WHATSAPP = "send_whatsapp", "Envoyer un WhatsApp"
    CHANGE_STATUS = "change_status", "Changer le statut"
    ADD_TAG = "add_tag", "Ajouter un tag"


class DelayUnit(models.TextChoices):
    MINUTES = "minutes", "minutes"
    HOURS = "hours", "heures"
    DAYS = "days", "jours"


class FollowUpRule(models.Model):
    """ "IF <trigger> THEN <action> AFTER <delay>".

    Only events that happen after the rule was (re)activated are considered, so
    switching a rule on never back-fills messages to the whole contact base.
    """

    name = models.CharField(max_length=150)
    trigger = models.CharField(max_length=30, choices=FollowUpTrigger.choices)
    trigger_status = models.CharField(max_length=20, choices=ContactStatus.choices, blank=True)
    action = models.CharField(max_length=30, choices=FollowUpAction.choices)
    action_status = models.CharField(max_length=20, choices=ContactStatus.choices, blank=True)
    action_tag = models.CharField(max_length=40, blank=True)
    message_template = models.TextField(blank=True)
    delay_amount = models.PositiveIntegerField(default=1)
    delay_unit = models.CharField(max_length=10, choices=DelayUnit.choices, default=DelayUnit.DAYS)
    is_active = models.BooleanField(default=True)
    # Numbers this rule never applies to (the other rules still do).
    excluded_contacts = models.ManyToManyField(Contact, blank=True, related_name="excluded_from_rules")
    activated_at = models.DateTimeField(default=timezone.now)
    last_run_at = models.DateTimeField(null=True, blank=True)
    run_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.name

    @property
    def delay(self) -> timedelta:
        return timedelta(**{self.delay_unit: self.delay_amount})

    def clean(self):
        errors = {}
        if self.trigger == FollowUpTrigger.STATUS_IS and not self.trigger_status:
            errors["trigger_status"] = "Choisissez le statut déclencheur."
        if self.action == FollowUpAction.CHANGE_STATUS and not self.action_status:
            errors["action_status"] = "Choisissez le nouveau statut."
        if self.action == FollowUpAction.ADD_TAG and not self.action_tag.strip():
            errors["action_tag"] = "Indiquez le tag à ajouter."
        if self.action == FollowUpAction.SEND_WHATSAPP and not self.message_template.strip():
            errors["message_template"] = "Rédigez le message à envoyer."
        if errors:
            raise ValidationError(errors)


class FollowUpExecution(models.Model):
    """Marks that a rule already ran for one occurrence of its trigger."""

    class Outcome(models.TextChoices):
        DONE = "done", "Exécutée"
        SKIPPED = "skipped", "Ignorée"

    rule = models.ForeignKey(FollowUpRule, on_delete=models.CASCADE, related_name="executions")
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="rule_executions")
    trigger_ref = models.CharField(max_length=64)
    outcome = models.CharField(max_length=10, choices=Outcome.choices, default=Outcome.DONE)
    detail = models.CharField(max_length=255, blank=True)
    executed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["rule", "contact", "trigger_ref"], name="unique_rule_execution")]


DEFAULT_REMINDER_TEMPLATE = (
    "Bonjour {first_name}, nous vous rappelons votre rendez-vous au Centre Focus le {date} à {time}. À très bientôt !"
)


class AppSettings(models.Model):
    """Singleton row holding the few settings editable from the UI."""

    class MessageLocale(models.TextChoices):
        FRENCH = "fr", "Français"
        ARABIC = "ar", "العربية"
        ENGLISH = "en", "English"

    automations_paused = models.BooleanField(default=False)
    paused_at = models.DateTimeField(null=True, blank=True)
    reminder_template = models.TextField(default=DEFAULT_REMINDER_TEMPLATE)
    message_locale = models.CharField(max_length=2, choices=MessageLocale.choices, default=MessageLocale.FRENCH)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "paramètres"
        verbose_name_plural = "paramètres"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Platform(models.TextChoices):
    FACEBOOK = "facebook", "Facebook"
    INSTAGRAM = "instagram", "Instagram"


class PostStatus(models.TextChoices):
    DRAFT = "draft", "Brouillon"
    SCHEDULED = "scheduled", "Programmé"
    PUBLISHED = "published", "Publié"


class MediaType(models.TextChoices):
    TEXT = "text", "Texte"
    IMAGE = "image", "Image"
    VIDEO = "video", "Vidéo"


IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"]
VIDEO_EXTENSIONS = ["mp4", "mov", "webm"]


def content_upload_to(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"content/{timezone.now():%Y/%m}/{uuid.uuid4().hex}.{ext}"


class ContentPost(models.Model):
    """A Facebook / Instagram post. Undated drafts live only in the content library."""

    title = models.CharField(max_length=150)
    body = models.TextField(blank=True)
    platforms = models.JSONField(default=list, blank=True)
    media_type = models.CharField(max_length=10, choices=MediaType.choices, default=MediaType.TEXT)
    media = models.FileField(
        upload_to=content_upload_to,
        blank=True,
        validators=[FileExtensionValidator(IMAGE_EXTENSIONS + VIDEO_EXTENSIONS)],
    )
    status = models.CharField(max_length=10, choices=PostStatus.choices, default=PostStatus.DRAFT, db_index=True)
    scheduled_at = models.DateTimeField(null=True, blank=True, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True)
    ai_generated = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title
