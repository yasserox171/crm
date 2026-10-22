"""AI-assisted drafting of Facebook / Instagram posts with Claude."""

import json
import logging

import anthropic
from django.conf import settings

logger = logging.getLogger(__name__)


class AINotConfigured(Exception):
    pass


class AIGenerationError(Exception):
    pass


LANGUAGE_NAMES = {
    "fr": "French",
    "ar": "Arabic (clear Modern Standard Arabic that Moroccan parents and students read easily)",
    "en": "English",
}

TONES = {
    "friendly": "warm and friendly",
    "professional": "professional and reassuring",
    "energetic": "energetic and motivating",
}

POST_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short internal title for the content library (max 8 words)."},
        "body": {"type": "string", "description": "The post text, ready to publish, without hashtags."},
        "hashtags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3 to 6 hashtags, each starting with #.",
        },
    },
    "required": ["title", "body", "hashtags"],
    "additionalProperties": False,
}


def _system_prompt() -> str:
    return (
        f"You write social media posts for {settings.CENTER_NAME}, a tutoring and training centre in "
        f"{settings.CENTER_CITY}, Morocco. The centre offers school support (primary to baccalauréat), "
        "language courses and professional training. Readers are mostly parents and students in the city. "
        "Write posts that are accurate, concrete and respectful; never invent prices, dates, results or "
        "promises that the brief does not state. End with a clear call to action inviting readers to "
        "contact the centre on WhatsApp or to visit."
    )


def generate_post(*, brief: str, platform: str, tone: str, language: str, media_type: str) -> dict:
    """Return ``{"title", "body", "hashtags"}`` for a post draft."""
    if not settings.ANTHROPIC_API_KEY:
        raise AINotConfigured()

    platform_hint = {
        "instagram": "Instagram: 60 to 120 words, a strong first line, a few emojis, line breaks between ideas.",
        "facebook": "Facebook: 80 to 180 words, informative, short paragraphs, at most a few emojis.",
    }.get(platform, "Facebook and Instagram: 70 to 140 words that work on both.")
    media_hint = {
        "image": "The post will be published with an image.",
        "video": "The post will be published with a short video.",
    }.get(media_type, "The post is text only.")

    user_prompt = (
        f"Brief from the centre's staff:\n<brief>\n{brief.strip()}\n</brief>\n\n"
        f"Write the post in {LANGUAGE_NAMES.get(language, LANGUAGE_NAMES['fr'])}. "
        f"Tone: {TONES.get(tone, TONES['friendly'])}. {platform_hint} {media_hint}"
    )

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=60, max_retries=2)
    try:
        response = client.beta.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=16000,
            system=_system_prompt(),
            messages=[{"role": "user", "content": user_prompt}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": POST_SCHEMA}},
            # On a policy decline, let the API retry on Anthropic's recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as exc:
        raise AIGenerationError("invalid_api_key") from exc
    except anthropic.RateLimitError as exc:
        raise AIGenerationError("rate_limited") from exc
    except anthropic.APIStatusError as exc:
        logger.warning("Claude API error %s: %s", exc.status_code, exc.message)
        raise AIGenerationError("api_error") from exc
    except anthropic.APIConnectionError as exc:
        raise AIGenerationError("network_error") from exc

    if response.stop_reason == "refusal":
        raise AIGenerationError("refused")
    if response.stop_reason == "max_tokens":
        raise AIGenerationError("truncated")

    text = next((block.text for block in response.content if block.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIGenerationError("invalid_response") from exc
    hashtags = [tag if tag.startswith("#") else f"#{tag}" for tag in data.get("hashtags", []) if tag.strip()]
    return {"title": data["title"].strip(), "body": data["body"].strip(), "hashtags": hashtags}
