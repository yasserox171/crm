from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from crm.automations import run_automations, set_excluded, upcoming
from crm.messaging import CANCELLED, dispatch_pending, queue_message
from crm.models import (
    Appointment,
    AppointmentStatus,
    AppSettings,
    Contact,
    ContactStatus,
    DeliveryStatus,
    FollowUpAction,
    FollowUpExecution,
    FollowUpRule,
    FollowUpTrigger,
    InteractionKind,
    InteractionLog,
    MessagePurpose,
)

from .factories import auth_client, make_contact


class AutomationTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.rule = FollowUpRule.objects.create(
            name="Relance",
            trigger=FollowUpTrigger.STATUS_IS,
            trigger_status=ContactStatus.NO_ANSWER,
            action=FollowUpAction.SEND_WHATSAPP,
            message_template="Bonjour {first_name}, toujours intéressé ?",
            delay_amount=2,
            delay_unit="days",
            activated_at=self.now - timedelta(days=10),
        )

    def _set_status(self, contact, status, days_ago):
        Contact.objects.filter(pk=contact.pk).update(
            status=status, status_changed_at=self.now - timedelta(days=days_ago)
        )

    def _sent(self):
        return InteractionLog.objects.filter(kind=InteractionKind.WHATSAPP_OUT, rule=self.rule)

    def test_fires_once_after_delay(self):
        due = make_contact(first_name="Omar")
        not_yet = make_contact(first_name="Hiba")
        self._set_status(due, ContactStatus.NO_ANSWER, days_ago=3)
        self._set_status(not_yet, ContactStatus.NO_ANSWER, days_ago=1)

        self.assertEqual(run_automations(self.now), 1)
        self.assertEqual(list(self._sent().values_list("body", flat=True)), ["Bonjour Omar, toujours intéressé ?"])
        self.assertEqual(run_automations(self.now), 0)  # no duplicate
        self.rule.refresh_from_db()
        self.assertEqual(self.rule.run_count, 1)

    def test_ignores_events_before_activation(self):
        old = make_contact()
        self._set_status(old, ContactStatus.NO_ANSWER, days_ago=30)
        self.assertEqual(run_automations(self.now), 0)

    def test_paused_and_inactive_rules_do_nothing(self):
        contact = make_contact()
        self._set_status(contact, ContactStatus.NO_ANSWER, days_ago=3)
        settings = AppSettings.load()
        settings.automations_paused = True
        settings.save()
        self.assertEqual(run_automations(self.now), 0)

        settings.automations_paused = False
        settings.save()
        FollowUpRule.objects.update(is_active=False)
        self.assertEqual(run_automations(self.now), 0)

    def test_whatsapp_requires_consent(self):
        contact = make_contact(consent=False)
        self._set_status(contact, ContactStatus.NO_ANSWER, days_ago=3)
        self.assertEqual(run_automations(self.now), 0)
        execution = FollowUpExecution.objects.get()
        self.assertEqual((execution.outcome, execution.detail), ("skipped", "no_consent"))
        self.assertFalse(self._sent().exists())

    def test_no_show_changes_status(self):
        rule = FollowUpRule.objects.create(
            name="Absent",
            trigger=FollowUpTrigger.APPOINTMENT_NO_SHOW,
            action=FollowUpAction.CHANGE_STATUS,
            action_status=ContactStatus.NO_ANSWER,
            delay_amount=1,
            delay_unit="hours",
            activated_at=self.now - timedelta(days=5),
        )
        contact = make_contact(status=ContactStatus.APPOINTMENT_SET)
        Appointment.objects.create(
            contact=contact, scheduled_at=self.now - timedelta(hours=3), status=AppointmentStatus.NO_SHOW
        )
        run_automations(self.now)
        contact.refresh_from_db()
        self.assertEqual(contact.status, ContactStatus.NO_ANSWER)
        log = contact.interactions.get(kind=InteractionKind.STATUS_CHANGE, rule=rule)
        self.assertEqual(log.metadata, {"from": "appointment_set", "to": "no_answer"})

    def test_no_interaction_adds_tag_once(self):
        rule = FollowUpRule.objects.create(
            name="Inactifs",
            trigger=FollowUpTrigger.NO_INTERACTION,
            action=FollowUpAction.ADD_TAG,
            action_tag="À relancer",
            delay_amount=7,
            delay_unit="days",
            activated_at=self.now - timedelta(days=1),
        )
        idle = make_contact()
        Contact.objects.filter(pk=idle.pk).update(created_at=self.now - timedelta(days=7, hours=12))
        active = make_contact()
        Contact.objects.filter(pk=active.pk).update(created_at=self.now - timedelta(days=20))
        InteractionLog.objects.create(
            contact=active, kind=InteractionKind.NOTE, created_at=self.now - timedelta(days=2)
        )

        run_automations(self.now)
        idle.refresh_from_db()
        active.refresh_from_db()
        self.assertEqual(idle.tags, ["À relancer"])
        self.assertEqual(active.tags, [])
        self.assertEqual(FollowUpExecution.objects.filter(rule=rule).count(), 1)


class ExclusionTests(TestCase):
    """The "contacts concernés" list and excluding numbers from automations."""

    def setUp(self):
        self.now = timezone.now()
        self.rule = FollowUpRule.objects.create(
            name="Relance",
            trigger=FollowUpTrigger.STATUS_IS,
            trigger_status=ContactStatus.NO_ANSWER,
            action=FollowUpAction.SEND_WHATSAPP,
            message_template="Bonjour {first_name}",
            delay_amount=2,
            delay_unit="days",
            activated_at=self.now - timedelta(days=10),
        )

    def _no_answer(self, contact, days_ago):
        Contact.objects.filter(pk=contact.pk).update(
            status=ContactStatus.NO_ANSWER, status_changed_at=self.now - timedelta(days=days_ago)
        )
        contact.refresh_from_db()
        return contact

    def test_upcoming_lists_only_contacts_the_action_will_reach(self):
        soon = self._no_answer(make_contact(first_name="Omar"), days_ago=1)
        self._no_answer(make_contact(), days_ago=3)  # already due: the worker handles it now
        self._no_answer(make_contact(consent=False), days_ago=1)  # would be skipped
        self._no_answer(make_contact(automations_excluded=True), days_ago=1)

        planned = upcoming(self.now)
        self.assertEqual([entry["contact"].pk for entry in planned], [soon.pk])
        self.assertEqual(
            planned[0]["actions"], [{"rule": self.rule, "due_at": soon.status_changed_at + timedelta(days=2)}]
        )

    def test_upcoming_groups_by_contact_soonest_first(self):
        welcome = FollowUpRule.objects.create(
            name="Bienvenue",
            trigger=FollowUpTrigger.CONTACT_CREATED,
            action=FollowUpAction.ADD_TAG,
            action_tag="Nouveau",
            delay_amount=1,
            delay_unit="days",
            activated_at=self.now - timedelta(days=10),
        )
        both = self._no_answer(make_contact(), days_ago=1)  # relance in 24 h, bienvenue in 23 h
        Contact.objects.filter(pk=both.pk).update(created_at=self.now - timedelta(hours=1))
        first = self._no_answer(make_contact(), days_ago=1.5)  # relance in 12 h
        Contact.objects.filter(pk=first.pk).update(created_at=self.now - timedelta(days=5))

        planned = upcoming(self.now)
        self.assertEqual([entry["contact"].pk for entry in planned], [first.pk, both.pk])
        self.assertEqual([item["rule"] for item in planned[1]["actions"]], [welcome, self.rule])

    def test_excluded_contact_is_skipped_and_not_replayed_when_brought_back(self):
        contact = self._no_answer(make_contact(), days_ago=3)
        self.assertEqual(set_excluded(Contact.objects.filter(pk=contact.pk), True), (1, 0))

        self.assertEqual(run_automations(self.now), 0)
        execution = FollowUpExecution.objects.get()
        self.assertEqual((execution.outcome, execution.detail), ("skipped", "excluded"))

        set_excluded(Contact.objects.filter(pk=contact.pk), False)
        self.assertEqual(run_automations(self.now), 0)
        self.assertFalse(InteractionLog.objects.filter(kind=InteractionKind.WHATSAPP_OUT).exists())

    def test_api_excludes_and_cancels_queued_automated_messages(self):
        client = auth_client()
        contact = make_contact()
        automated = queue_message(contact, "Relance", purpose=MessagePurpose.AUTOMATION, rule=self.rule)
        manual = queue_message(contact, "Bonjour", purpose=MessagePurpose.MANUAL)

        response = client.post(
            "/api/automations/exclusions/", {"contact_ids": [contact.pk], "excluded": True}, format="json"
        )
        self.assertEqual(response.json(), {"updated": 1, "cancelled": 1})
        automated.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual((automated.delivery_status, automated.error), (DeliveryStatus.FAILED, CANCELLED))
        self.assertEqual(manual.delivery_status, DeliveryStatus.PENDING)

        audience = client.get("/api/automations/audience/").json()
        self.assertEqual([item["id"] for item in audience["excluded"]], [contact.pk])
        self.assertEqual(audience["excluded_total"], 1)

        response = client.post(
            "/api/automations/exclusions/", {"contact_ids": [contact.pk], "excluded": False}, format="json"
        )
        self.assertEqual(response.json(), {"updated": 1, "cancelled": 0})
        contact.refresh_from_db()
        self.assertEqual((contact.automations_excluded, contact.automations_excluded_at), (False, None))

    def test_audience_lists_planned_actions(self):
        contact = self._no_answer(make_contact(first_name="Omar"), days_ago=1)
        audience = auth_client().get("/api/automations/audience/").json()
        self.assertEqual(audience["upcoming_total"], 1)
        item = audience["upcoming"][0]
        self.assertEqual(item["contact"]["id"], contact.pk)
        self.assertEqual(item["actions"][0]["rule_name"], "Relance")
        self.assertEqual(item["actions"][0]["action"], "send_whatsapp")

    @override_settings(MESSAGING_BACKEND="console")
    def test_dispatch_drops_automated_message_of_contact_excluded_meanwhile(self):
        contact = make_contact()
        automated = queue_message(contact, "Relance", purpose=MessagePurpose.AUTOMATION, rule=self.rule)
        manual = queue_message(contact, "Bonjour", purpose=MessagePurpose.MANUAL)
        Contact.objects.filter(pk=contact.pk).update(automations_excluded=True)

        self.assertEqual(dispatch_pending(), 1)
        automated.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual((automated.delivery_status, automated.error), (DeliveryStatus.FAILED, CANCELLED))
        self.assertEqual(manual.delivery_status, DeliveryStatus.SENT)

    def test_exclusion_is_read_only_on_contacts_and_needs_login(self):
        contact = make_contact()
        auth_client().patch(f"/api/contacts/{contact.pk}/", {"automations_excluded": True}, format="json")
        contact.refresh_from_db()
        self.assertFalse(contact.automations_excluded)
        self.assertEqual(APIClient().get("/api/automations/audience/").status_code, 403)
        self.assertEqual(APIClient().post("/api/automations/exclusions/", {}).status_code, 403)


class RuleExclusionTests(TestCase):
    """Numbers ticked off in one rule's form: that rule skips them, the others don't."""

    def setUp(self):
        self.now = timezone.now()
        common = {
            "trigger": FollowUpTrigger.STATUS_IS,
            "trigger_status": ContactStatus.NO_ANSWER,
            "delay_amount": 2,
            "delay_unit": "days",
            "activated_at": self.now - timedelta(days=10),
        }
        self.relance = FollowUpRule.objects.create(
            name="Relance", action=FollowUpAction.SEND_WHATSAPP, message_template="Bonjour {first_name}", **common
        )
        self.tag = FollowUpRule.objects.create(
            name="Tag", action=FollowUpAction.ADD_TAG, action_tag="À rappeler", **common
        )
        self.client = auth_client()

    def _no_answer(self, contact, days_ago):
        Contact.objects.filter(pk=contact.pk).update(
            status=ContactStatus.NO_ANSWER, status_changed_at=self.now - timedelta(days=days_ago)
        )
        contact.refresh_from_db()
        return contact

    def test_excluded_number_skips_only_that_rule(self):
        contact = self._no_answer(make_contact(), days_ago=3)
        self.relance.excluded_contacts.add(contact)

        self.assertEqual(run_automations(self.now), 1)
        skipped = FollowUpExecution.objects.get(rule=self.relance)
        self.assertEqual((skipped.outcome, skipped.detail), ("skipped", "excluded"))
        self.assertFalse(InteractionLog.objects.filter(kind=InteractionKind.WHATSAPP_OUT).exists())
        contact.refresh_from_db()
        self.assertEqual(contact.tags, ["À rappeler"])

    def test_upcoming_respects_rule_exclusions(self):
        contact = self._no_answer(make_contact(), days_ago=1)
        self.relance.excluded_contacts.add(contact)
        [entry] = upcoming(self.now)
        self.assertEqual([item["rule"] for item in entry["actions"]], [self.tag])

    def test_saving_exclusions_cancels_only_this_rules_queued_messages(self):
        contact, other = make_contact(), make_contact()
        mine = queue_message(contact, "Relance", purpose=MessagePurpose.AUTOMATION, rule=self.relance)
        from_other_rule = queue_message(contact, "Autre", purpose=MessagePurpose.AUTOMATION, rule=self.tag)
        not_excluded = queue_message(other, "Relance", purpose=MessagePurpose.AUTOMATION, rule=self.relance)

        response = self.client.patch(
            f"/api/automations/rules/{self.relance.pk}/", {"excluded_contacts": [contact.pk]}, format="json"
        )
        self.assertEqual(response.json()["excluded_contacts"], [contact.pk])
        statuses = {
            message.pk: message.delivery_status
            for message in InteractionLog.objects.filter(pk__in=[mine.pk, from_other_rule.pk, not_excluded.pk])
        }
        self.assertEqual(statuses[mine.pk], DeliveryStatus.FAILED)
        self.assertEqual(statuses[from_other_rule.pk], DeliveryStatus.PENDING)
        self.assertEqual(statuses[not_excluded.pk], DeliveryStatus.PENDING)

        # A plain toggle leaves the exclusions alone.
        self.client.patch(f"/api/automations/rules/{self.relance.pk}/", {"is_active": False}, format="json")
        self.assertEqual(list(self.relance.excluded_contacts.values_list("pk", flat=True)), [contact.pk])

    def test_rule_contacts_lists_everyone_with_planned_actions_first(self):
        later = make_contact(first_name="Amine")
        planned = self._no_answer(make_contact(first_name="Zineb"), days_ago=1)
        self.relance.excluded_contacts.add(planned)  # still shown as planned: the form decides

        rows = self.client.get(f"/api/automations/rules/contacts/?rule={self.relance.pk}").json()
        self.assertEqual([row["id"] for row in rows], [planned.pk, later.pk])
        self.assertIsNotNone(rows[0]["due_at"])
        self.assertIsNone(rows[1]["due_at"])

        new_rule_rows = self.client.get("/api/automations/rules/contacts/").json()
        self.assertTrue(all(row["due_at"] is None for row in new_rule_rows))
        self.assertEqual(self.client.get("/api/automations/rules/contacts/?rule=999").status_code, 404)

    @override_settings(MESSAGING_BACKEND="console")
    def test_dispatch_drops_message_of_number_excluded_from_its_rule(self):
        contact = make_contact()
        message = queue_message(contact, "Relance", purpose=MessagePurpose.AUTOMATION, rule=self.relance)
        self.relance.excluded_contacts.add(contact)  # added directly: no cancellation on save
        dispatch_pending()
        message.refresh_from_db()
        self.assertEqual((message.delivery_status, message.error), (DeliveryStatus.FAILED, CANCELLED))
