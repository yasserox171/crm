/**
 * Moroccan phone numbers — mirrors backend/crm/phone.py.
 * Stored as E.164 (+212612345678), always displayed as "+212 612 345678".
 */

const COUNTRY_CODE = '212'

/** Returns the 9-digit national number, or null when the input isn't a valid Moroccan number. */
export function nationalDigits(raw: string): string | null {
  let digits = (raw ?? '').replace(/\D+/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith(COUNTRY_CODE) && digits.length >= 12) digits = digits.slice(COUNTRY_CODE.length)
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1)
  if (digits.length !== 9 || !'5678'.includes(digits[0])) return null
  return digits
}

/** Digits usable to search stored numbers (drops the leading 0 / country code) — like search_digits(). */
export function searchDigits(query: string): string {
  let digits = (query ?? '').replace(/\D+/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith(COUNTRY_CODE) && digits.length > 3) digits = digits.slice(COUNTRY_CODE.length)
  return digits.replace(/^0+/, '')
}

export function normalizePhone(raw: string): string | null {
  const digits = nationalDigits(raw)
  return digits ? `+${COUNTRY_CODE}${digits}` : null
}

export function formatPhone(value: string): string {
  const digits = nationalDigits(value)
  return digits ? `+${COUNTRY_CODE} ${digits.slice(0, 3)} ${digits.slice(3)}` : value
}

/** wa.me link for a stored number, optionally with the message pre-filled. */
export function whatsappLink(value: string, text?: string): string {
  const digits = nationalDigits(value)
  const base = `https://wa.me/${COUNTRY_CODE}${digits ?? ''}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
