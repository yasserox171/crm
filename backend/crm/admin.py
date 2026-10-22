from django.contrib import admin

from .models import (
    Appointment,
    AppSettings,
    Contact,
    ContentPost,
    FollowUpExecution,
    FollowUpRule,
    InteractionLog,
)


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = [
        "full_name",
        "phone_display",
        "city",
        "subject",
        "level",
        "status",
        "source",
        "consent",
        "registered_at",
    ]
    list_filter = ["status", "source", "consent", "level"]
    search_fields = ["first_name", "last_name", "phone", "city", "subject"]
    date_hierarchy = "registered_at"


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ["contact", "title", "scheduled_at", "status", "last_reminder_at"]
    list_filter = ["status"]
    search_fields = ["contact__first_name", "contact__last_name", "title"]
    autocomplete_fields = ["contact"]
    date_hierarchy = "scheduled_at"


@admin.register(InteractionLog)
class InteractionLogAdmin(admin.ModelAdmin):
    list_display = ["contact", "kind", "purpose", "delivery_status", "created_at", "sent_at"]
    list_filter = ["kind", "purpose", "delivery_status"]
    search_fields = ["contact__first_name", "contact__last_name", "body"]
    raw_id_fields = ["contact", "appointment", "rule"]


@admin.register(FollowUpRule)
class FollowUpRuleAdmin(admin.ModelAdmin):
    list_display = ["name", "trigger", "action", "delay_amount", "delay_unit", "is_active", "run_count", "last_run_at"]
    list_filter = ["is_active", "trigger", "action"]


@admin.register(FollowUpExecution)
class FollowUpExecutionAdmin(admin.ModelAdmin):
    list_display = ["rule", "contact", "trigger_ref", "outcome", "executed_at"]
    list_filter = ["outcome", "rule"]
    raw_id_fields = ["contact"]


@admin.register(ContentPost)
class ContentPostAdmin(admin.ModelAdmin):
    list_display = ["title", "status", "media_type", "scheduled_at", "ai_generated"]
    list_filter = ["status", "media_type", "ai_generated"]
    search_fields = ["title", "body"]


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ["automations_paused", "message_locale", "updated_at"]

    def has_add_permission(self, request):
        return not AppSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
