from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from . import automations, services
from .models import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    Appointment,
    AppSettings,
    Contact,
    ContentPost,
    FollowUpAction,
    FollowUpRule,
    FollowUpTrigger,
    InteractionKind,
    InteractionLog,
    MediaType,
    Platform,
    PostStatus,
)
from .phone import InvalidPhoneNumber, normalize_phone

User = get_user_model()


class PhoneField(serializers.CharField):
    default_error_messages = {"invalid_phone": "Numéro marocain invalide (ex. 06 12 34 56 78)."}

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return normalize_phone(value)
        except InvalidPhoneNumber:
            self.fail("invalid_phone")


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "display_name", "preferred_language"]
        read_only_fields = ["id", "email", "display_name"]


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)


class ContactSummarySerializer(serializers.ModelSerializer):
    phone_display = serializers.CharField(read_only=True)

    class Meta:
        model = Contact
        fields = ["id", "first_name", "last_name", "full_name", "phone", "phone_display", "status", "consent"]


class ContactSerializer(serializers.ModelSerializer):
    phone = PhoneField(max_length=32)
    phone_display = serializers.CharField(read_only=True)
    tags = serializers.ListField(
        child=serializers.CharField(max_length=40, trim_whitespace=True), required=False, max_length=20
    )
    next_appointment = serializers.SerializerMethodField()

    class Meta:
        model = Contact
        fields = [
            "id",
            "first_name",
            "last_name",
            "full_name",
            "phone",
            "phone_display",
            "city",
            "subject",
            "level",
            "status",
            "status_changed_at",
            "source",
            "consent",
            "consent_at",
            "automations_excluded",
            "automations_excluded_at",
            "tags",
            "registered_at",
            "next_appointment",
            "created_at",
            "updated_at",
        ]
        # Exclusion goes through automations/exclusions/, which also cancels queued messages.
        read_only_fields = [
            "status_changed_at",
            "consent_at",
            "automations_excluded",
            "automations_excluded_at",
            "created_at",
            "updated_at",
        ]

    def get_next_appointment(self, obj):
        upcoming = getattr(obj, "upcoming", None)
        if upcoming is None:
            return None
        appointment = upcoming[0] if upcoming else None
        return appointment and {
            "id": appointment.id,
            "scheduled_at": appointment.scheduled_at,
            "title": appointment.title,
        }

    def validate_tags(self, value):
        seen = []
        for tag in value:
            if tag and tag not in seen:
                seen.append(tag)
        return seen

    @transaction.atomic
    def create(self, validated_data):
        contact = super().create(validated_data)
        InteractionLog.objects.create(
            contact=contact,
            kind=InteractionKind.STATUS_CHANGE,
            metadata={"event": "created", "from": None, "to": contact.status, "source": contact.source},
            created_by=self.context["request"].user,
        )
        return contact

    @transaction.atomic
    def update(self, instance, validated_data):
        new_status = validated_data.pop("status", instance.status)
        instance = super().update(instance, validated_data)
        services.change_status(instance, new_status, user=self.context["request"].user)
        return instance


class InteractionSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.display_name", default=None, read_only=True)
    rule_name = serializers.CharField(source="rule.name", default=None, read_only=True)
    appointment_at = serializers.DateTimeField(source="appointment.scheduled_at", default=None, read_only=True)

    class Meta:
        model = InteractionLog
        fields = [
            "id",
            "contact",
            "kind",
            "body",
            "purpose",
            "delivery_status",
            "sent_at",
            "error",
            "batch_id",
            "appointment",
            "appointment_at",
            "rule",
            "rule_name",
            "metadata",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class NoteSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)


class MessageStatusSerializer(serializers.ModelSerializer):
    """A queued/sent WhatsApp message, as shown on the reminders status panel."""

    contact = ContactSummarySerializer(read_only=True)
    appointment_at = serializers.DateTimeField(source="appointment.scheduled_at", default=None, read_only=True)
    sent_manually = serializers.SerializerMethodField()

    class Meta:
        model = InteractionLog
        fields = [
            "id",
            "contact",
            "body",
            "purpose",
            "delivery_status",
            "sent_manually",
            "sent_at",
            "error",
            "attempts",
            "batch_id",
            "appointment",
            "appointment_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_sent_manually(self, obj):
        return obj.external_id == "manual"


class AppointmentSerializer(serializers.ModelSerializer):
    contact_detail = ContactSummarySerializer(source="contact", read_only=True)

    class Meta:
        model = Appointment
        fields = [
            "id",
            "contact",
            "contact_detail",
            "title",
            "scheduled_at",
            "duration_minutes",
            "notes",
            "status",
            "last_reminder_at",
            "created_at",
        ]
        read_only_fields = ["last_reminder_at", "created_at"]

    def validate(self, attrs):
        if self.instance is None and attrs.get("scheduled_at") and attrs["scheduled_at"] < timezone.now():
            if attrs.get("status", "scheduled") == "scheduled":
                raise serializers.ValidationError({"scheduled_at": "La date du rendez-vous est déjà passée."})
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        appointment = Appointment.objects.create(created_by=user, **validated_data)
        services.record_appointment_created(appointment, user=user)
        return appointment

    def update(self, instance, validated_data):
        previous = {"scheduled_at": instance.scheduled_at, "status": instance.status}
        validated_data.pop("contact", None)  # an appointment can't move to another contact
        instance = super().update(instance, validated_data)
        services.record_appointment_updated(instance, previous, user=self.context["request"].user)
        return instance


class ContactSelectionFiltersSerializer(serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=200)
    status = serializers.CharField(required=False, allow_blank=True, max_length=20)
    source = serializers.CharField(required=False, allow_blank=True, max_length=20)


class BulkMessageSerializer(serializers.Serializer):
    """Recipients are either explicit contact ids or every contact matching the list filters."""

    contact_ids = serializers.ListField(child=serializers.IntegerField(), required=False, max_length=5000)
    filters = ContactSelectionFiltersSerializer(required=False)
    body = serializers.CharField(max_length=1000, allow_blank=True, trim_whitespace=False, required=False, default="")

    def validate(self, attrs):
        if not attrs.get("contact_ids") and "filters" not in attrs:
            raise serializers.ValidationError({"contact_ids": "Sélectionnez au moins un contact."})
        return attrs


class ReminderRequestSerializer(serializers.Serializer):
    appointment_ids = serializers.ListField(child=serializers.IntegerField(), min_length=1, max_length=200)
    template = serializers.CharField(max_length=1000)
    save_template = serializers.BooleanField(default=False)


class AppSettingsSerializer(serializers.ModelSerializer):
    # False while MESSAGING_BACKEND=console: messages are only logged, never delivered.
    whatsapp_live = serializers.SerializerMethodField()
    # "live" (WhatsApp API), "web" (linked account), "manual" (sent by hand) or "test" (logged only).
    messaging_mode = serializers.SerializerMethodField()

    class Meta:
        model = AppSettings
        fields = [
            "automations_paused",
            "paused_at",
            "reminder_template",
            "message_locale",
            "whatsapp_live",
            "messaging_mode",
            "updated_at",
        ]
        read_only_fields = ["paused_at", "updated_at"]

    def get_whatsapp_live(self, obj):
        return settings.MESSAGING_BACKEND == "whatsapp_cloud"

    def get_messaging_mode(self, obj):
        return {"whatsapp_cloud": "live", "whatsapp_web": "web", "manual": "manual"}.get(
            settings.MESSAGING_BACKEND, "test"
        )

    def update(self, instance, validated_data):
        paused = validated_data.get("automations_paused", instance.automations_paused)
        if paused != instance.automations_paused:
            instance.paused_at = timezone.now() if paused else None
        return super().update(instance, validated_data)


class AutomationExclusionSerializer(serializers.Serializer):
    contact_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=500)
    excluded = serializers.BooleanField()


class FollowUpRuleSerializer(serializers.ModelSerializer):
    executions_skipped = serializers.IntegerField(read_only=True, default=0)
    excluded_contacts = serializers.PrimaryKeyRelatedField(many=True, queryset=Contact.objects.all(), required=False)

    class Meta:
        model = FollowUpRule
        fields = [
            "id",
            "name",
            "trigger",
            "trigger_status",
            "action",
            "action_status",
            "action_tag",
            "message_template",
            "delay_amount",
            "delay_unit",
            "is_active",
            "excluded_contacts",
            "activated_at",
            "last_run_at",
            "run_count",
            "executions_skipped",
            "created_at",
        ]
        read_only_fields = ["activated_at", "last_run_at", "run_count", "created_at"]

    def validate_delay_amount(self, value):
        if value > 10000:
            raise serializers.ValidationError("Délai trop long.")
        return value

    def validate(self, attrs):
        data = {**self._current_values(), **attrs}
        errors = {}
        if data["trigger"] == FollowUpTrigger.STATUS_IS and not data.get("trigger_status"):
            errors["trigger_status"] = "Choisissez le statut déclencheur."
        if data["action"] == FollowUpAction.CHANGE_STATUS and not data.get("action_status"):
            errors["action_status"] = "Choisissez le nouveau statut."
        if data["action"] == FollowUpAction.ADD_TAG and not data.get("action_tag", "").strip():
            errors["action_tag"] = "Indiquez le tag à ajouter."
        if data["action"] == FollowUpAction.SEND_WHATSAPP and not data.get("message_template", "").strip():
            errors["message_template"] = "Rédigez le message à envoyer."
        if errors:
            raise serializers.ValidationError(errors)
        # Clear parameters that don't apply to the chosen trigger / action.
        if data["trigger"] != FollowUpTrigger.STATUS_IS:
            attrs["trigger_status"] = ""
        if data["action"] != FollowUpAction.CHANGE_STATUS:
            attrs["action_status"] = ""
        if data["action"] != FollowUpAction.ADD_TAG:
            attrs["action_tag"] = ""
        return attrs

    def _current_values(self):
        if self.instance is None:
            return {}
        return {field: getattr(self.instance, field) for field in self.Meta.fields if hasattr(self.instance, field)}

    @transaction.atomic
    def update(self, instance, validated_data):
        if validated_data.get("is_active") and not instance.is_active:
            # Re-activation: only events from now on are considered.
            validated_data["activated_at"] = timezone.now()
        before = set(instance.excluded_contacts.values_list("pk", flat=True))
        rule = super().update(instance, validated_data)
        if newly_excluded := set(rule.excluded_contacts.values_list("pk", flat=True)) - before:
            automations.cancel_queued(rule, newly_excluded)
        return rule


class ContentPostSerializer(serializers.ModelSerializer):
    platforms = serializers.ListField(
        child=serializers.ChoiceField(choices=Platform.choices), required=False, max_length=2
    )
    media_url = serializers.SerializerMethodField()
    remove_media = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = ContentPost
        fields = [
            "id",
            "title",
            "body",
            "platforms",
            "media_type",
            "media",
            "media_url",
            "remove_media",
            "status",
            "scheduled_at",
            "published_at",
            "ai_generated",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["published_at", "created_at", "updated_at"]
        extra_kwargs = {"media": {"write_only": True, "required": False}}

    def get_media_url(self, obj):
        return obj.media.url if obj.media else None

    def to_internal_value(self, data):
        # Multipart forms send list fields as repeated keys.
        if hasattr(data, "getlist") and "platforms" in data:
            data = data.copy()
            platforms = [p for p in data.getlist("platforms") if p]
            data.setlist("platforms", platforms)
        return super().to_internal_value(data)

    def validate_platforms(self, value):
        return list(dict.fromkeys(value))

    def validate_media(self, file):
        if file and file.size > settings.CONTENT_MEDIA_MAX_BYTES:
            raise serializers.ValidationError("Fichier trop volumineux.")
        return file

    def validate(self, attrs):
        data = {
            "status": getattr(self.instance, "status", PostStatus.DRAFT),
            "scheduled_at": getattr(self.instance, "scheduled_at", None),
            "media_type": getattr(self.instance, "media_type", MediaType.TEXT),
            **attrs,
        }
        if data["status"] == PostStatus.SCHEDULED and not data["scheduled_at"]:
            raise serializers.ValidationError({"scheduled_at": "Choisissez la date de publication."})
        media = attrs.get("media")
        if media:
            ext = media.name.rsplit(".", 1)[-1].lower()
            expected = {MediaType.IMAGE: IMAGE_EXTENSIONS, MediaType.VIDEO: VIDEO_EXTENSIONS}.get(data["media_type"])
            if expected is None or ext not in expected:
                raise serializers.ValidationError({"media": "Le fichier ne correspond pas au type de contenu."})
        return attrs

    def _apply_status_dates(self, validated_data, instance=None):
        status = validated_data.get("status", getattr(instance, "status", None))
        if status == PostStatus.PUBLISHED and not getattr(instance, "published_at", None):
            validated_data["published_at"] = timezone.now()
            if not validated_data.get("scheduled_at", getattr(instance, "scheduled_at", None)):
                validated_data["scheduled_at"] = validated_data["published_at"]
        elif status != PostStatus.PUBLISHED:
            validated_data["published_at"] = None

    def create(self, validated_data):
        validated_data.pop("remove_media", None)
        self._apply_status_dates(validated_data)
        return ContentPost.objects.create(created_by=self.context["request"].user, **validated_data)

    def update(self, instance, validated_data):
        if validated_data.pop("remove_media", False) and instance.media:
            instance.media.delete(save=False)
            instance.media = ""
        if validated_data.get("media_type") == MediaType.TEXT and instance.media:
            instance.media.delete(save=False)
            instance.media = ""
        self._apply_status_dates(validated_data, instance)
        return super().update(instance, validated_data)


class GeneratePostSerializer(serializers.Serializer):
    brief = serializers.CharField(max_length=2000)
    platform = serializers.ChoiceField(choices=["facebook", "instagram", "both"], default="both")
    tone = serializers.ChoiceField(choices=["friendly", "professional", "energetic"], default="friendly")
    language = serializers.ChoiceField(choices=["fr", "ar", "en"], default="fr")
    media_type = serializers.ChoiceField(choices=MediaType.choices, default=MediaType.TEXT)
