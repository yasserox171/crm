import calendar
from datetime import datetime, time, timedelta

import django_filters
from django.db.models import Q, Value
from django.db.models.functions import Concat
from django.utils import timezone

from .models import (
    Appointment,
    AppointmentStatus,
    Contact,
    ContactSource,
    ContactStatus,
    ContentPost,
    DeliveryStatus,
    InteractionKind,
    InteractionLog,
    MediaType,
    MessagePurpose,
    PostStatus,
)
from .phone import InvalidPhoneNumber, normalize_phone, search_digits


class ContactFilter(django_filters.FilterSet):
    search = django_filters.CharFilter(method="filter_search")
    status = django_filters.ChoiceFilter(choices=ContactStatus.choices)
    source = django_filters.ChoiceFilter(choices=ContactSource.choices)
    consent = django_filters.BooleanFilter()
    phone = django_filters.CharFilter(method="filter_phone")
    tag = django_filters.CharFilter(method="filter_tag")

    class Meta:
        model = Contact
        fields = ["status", "source", "consent", "level"]

    def filter_search(self, queryset, name, value):
        value = value.strip()
        if not value:
            return queryset
        query = (
            Q(full_name_search__icontains=value)
            | Q(last_name__icontains=value)
            | Q(city__icontains=value)
            | Q(subject__icontains=value)
            | Q(tags__icontains=value)
        )
        digits = search_digits(value)
        if len(digits) >= 3:
            query |= Q(phone__contains=digits)
        return queryset.annotate(full_name_search=Concat("first_name", Value(" "), "last_name")).filter(query)

    def filter_phone(self, queryset, name, value):
        try:
            return queryset.filter(phone=normalize_phone(value))
        except InvalidPhoneNumber:
            return queryset.none()

    def filter_tag(self, queryset, name, value):
        return queryset.filter(tags__contains=[value])


class AppointmentFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=AppointmentStatus.choices)
    upcoming = django_filters.BooleanFilter(method="filter_upcoming")
    days = django_filters.NumberFilter(method="filter_days")
    start = django_filters.IsoDateTimeFilter(field_name="scheduled_at", lookup_expr="gte")
    end = django_filters.IsoDateTimeFilter(field_name="scheduled_at", lookup_expr="lt")

    class Meta:
        model = Appointment
        fields = ["contact", "status"]

    def filter_upcoming(self, queryset, name, value):
        if value:
            return queryset.filter(status=AppointmentStatus.SCHEDULED, scheduled_at__gte=timezone.now())
        return queryset

    def filter_days(self, queryset, name, value):
        days = max(1, min(int(value), 90))
        # Up to the end of the last day, in local time.
        last_day = timezone.localdate() + timedelta(days=days - 1)
        end = timezone.make_aware(datetime.combine(last_day + timedelta(days=1), time.min))
        return queryset.filter(scheduled_at__lt=end)


class MessageFilter(django_filters.FilterSet):
    purpose = django_filters.ChoiceFilter(choices=MessagePurpose.choices)
    delivery_status = django_filters.ChoiceFilter(choices=DeliveryStatus.choices)
    batch_id = django_filters.UUIDFilter()

    class Meta:
        model = InteractionLog
        fields = ["purpose", "delivery_status", "batch_id", "contact"]

    @property
    def qs(self):
        return super().qs.filter(kind=InteractionKind.WHATSAPP_OUT)


class ContentPostFilter(django_filters.FilterSet):
    month = django_filters.CharFilter(method="filter_month")
    status = django_filters.ChoiceFilter(choices=PostStatus.choices)
    media_type = django_filters.ChoiceFilter(choices=MediaType.choices)
    search = django_filters.CharFilter(method="filter_search")

    class Meta:
        model = ContentPost
        fields = ["status", "media_type"]

    def filter_month(self, queryset, name, value):
        """``YYYY-MM``: posts dated in that month (local time)."""
        try:
            year, month = (int(part) for part in value.split("-"))
            first = datetime(year, month, 1)
        except ValueError:
            return queryset.none()
        days = calendar.monthrange(year, month)[1]
        start = timezone.make_aware(first)
        end = timezone.make_aware(first + timedelta(days=days))
        return queryset.filter(scheduled_at__gte=start, scheduled_at__lt=end)

    def filter_search(self, queryset, name, value):
        return queryset.filter(Q(title__icontains=value) | Q(body__icontains=value))
