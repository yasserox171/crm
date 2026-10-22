import logging
import random
import signal
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections

from crm.automations import run_automations
from crm.messaging import dispatch_pending, is_web_mode

logger = logging.getLogger("crm.worker")


class Command(BaseCommand):
    help = "Sends queued WhatsApp messages and runs follow-up automations in a loop."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run a single pass and exit.")

    def handle(self, *args, once=False, **options):
        self._stop = False
        signal.signal(signal.SIGTERM, self._request_stop)
        signal.signal(signal.SIGINT, self._request_stop)
        last_automation_run = 0.0
        # Linked WhatsApp account: never send two messages back to back.
        next_web_send = 0.0
        logger.info("Worker started (backend: %s)", settings.MESSAGING_BACKEND)
        while not self._stop:
            close_old_connections()
            try:
                now = time.monotonic()
                if once or now - last_automation_run >= settings.AUTOMATION_INTERVAL_SECONDS:
                    last_automation_run = now
                    applied = run_automations()
                    if applied:
                        logger.info("Automations: %s action(s) applied", applied)
                if is_web_mode():
                    sent = dispatch_pending() if now >= next_web_send else 0
                    if sent:
                        pause = random.uniform(settings.WA_WEB_MIN_DELAY_SECONDS, settings.WA_WEB_MAX_DELAY_SECONDS)
                        next_web_send = time.monotonic() + pause
                        logger.info("Message processed via linked WhatsApp; next one in %.0f s", pause)
                else:
                    sent = dispatch_pending()
                    if sent:
                        logger.info("Messages processed: %s", sent)
            except Exception:
                logger.exception("Worker iteration failed")
            if once:
                break
            self._sleep(settings.WORKER_INTERVAL_SECONDS)
        logger.info("Worker stopped")

    def _request_stop(self, *_):
        self._stop = True

    def _sleep(self, seconds):
        deadline = time.monotonic() + seconds
        while not self._stop and time.monotonic() < deadline:
            time.sleep(0.5)
