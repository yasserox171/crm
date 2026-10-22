from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("contacts", views.ContactViewSet, basename="contact")
router.register("appointments", views.AppointmentViewSet, basename="appointment")
router.register("messages", views.MessageViewSet, basename="message")
router.register("automations/rules", views.FollowUpRuleViewSet, basename="rule")
router.register("content/posts", views.ContentPostViewSet, basename="post")

urlpatterns = [
    path("health/", views.health, name="health"),
    path("auth/csrf/", views.csrf, name="csrf"),
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/me/", views.MeView.as_view(), name="me"),
    path("settings/", views.AppSettingsView.as_view(), name="settings"),
    path("automations/audience/", views.AutomationAudienceView.as_view(), name="automation-audience"),
    path("automations/exclusions/", views.AutomationExclusionsView.as_view(), name="automation-exclusions"),
    path("reminders/preview/", views.ReminderPreviewView.as_view(), name="reminder-preview"),
    path("reminders/send/", views.ReminderSendView.as_view(), name="reminder-send"),
    path("whatsapp/status/", views.WhatsAppStatusView.as_view(), name="whatsapp-status"),
    path("whatsapp/logout/", views.WhatsAppLogoutView.as_view(), name="whatsapp-logout"),
    path("whatsapp/incoming/", views.WhatsAppIncomingView.as_view(), name="whatsapp-incoming"),
    path("whatsapp/chats/", views.WhatsAppChatsView.as_view(), name="whatsapp-chats"),
    path("whatsapp/chats/<str:chat_id>/messages/", views.WhatsAppChatMessagesView.as_view(), name="whatsapp-messages"),
    path("whatsapp/chats/<str:chat_id>/reply/", views.WhatsAppChatReplyView.as_view(), name="whatsapp-reply"),
    path("", include(router.urls)),
]
