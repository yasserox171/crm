"""Moroccan phone numbers.

Numbers are stored in E.164 (``+212612345678``) and always displayed as
``+212 612 345678`` (``+212 6XX XXXXXX``), whatever the input format:
``06 12 34 56 78``, ``0612345678``, ``+212 6 12 34 56 78``, ``00212612345678``,
``212612345678``, ``+212 0612345678`` or ``612345678``.

The same rules are implemented client-side in ``frontend/src/lib/phone.ts``.
"""

import re

COUNTRY_CODE = "212"
_NON_DIGITS = re.compile(r"\D+")


class InvalidPhoneNumber(ValueError):
    pass


def national_digits(raw: str) -> str:
    """Return the 9-digit national significant number, or raise InvalidPhoneNumber."""
    digits = _NON_DIGITS.sub("", raw or "")
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith(COUNTRY_CODE) and len(digits) >= 12:
        digits = digits[len(COUNTRY_CODE) :]
    if digits.startswith("0") and len(digits) == 10:
        digits = digits[1:]
    # Moroccan numbers: 5xx (landline), 6xx / 7xx (mobile), 8xx (VoIP).
    if len(digits) != 9 or digits[0] not in "5678":
        raise InvalidPhoneNumber(raw)
    return digits


def normalize_phone(raw: str) -> str:
    """Normalize any accepted input to E.164 (+212XXXXXXXXX)."""
    return f"+{COUNTRY_CODE}{national_digits(raw)}"


def format_phone(value: str) -> str:
    """Format a stored number as ``+212 6XX XXXXXX``. Unparseable values are returned unchanged."""
    try:
        digits = national_digits(value)
    except InvalidPhoneNumber:
        return value or ""
    return f"+{COUNTRY_CODE} {digits[:3]} {digits[3:]}"


def search_digits(query: str) -> str:
    """Digits usable to search stored numbers (drops the leading 0 / country code)."""
    digits = _NON_DIGITS.sub("", query or "")
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith(COUNTRY_CODE) and len(digits) > 3:
        digits = digits[len(COUNTRY_CODE) :]
    return digits.lstrip("0")
