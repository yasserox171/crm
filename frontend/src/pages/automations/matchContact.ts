import type { RuleContact } from '../../api/types'
import { searchDigits } from '../../lib/phone'

/** Search box match: name, or 3+ digits of the number (typed as 06…, +212 6… or 6…). `needle` is lower-cased. */
export function matchContact(contact: { full_name: string; phone: string }, needle: string) {
  if (!needle) return true
  const digits = searchDigits(needle)
  return contact.full_name.toLowerCase().includes(needle) || (digits.length >= 3 && contact.phone.includes(digits))
}

/** Out of a rule: unticked in its form, or excluded from every automation. */
export function isOutOfRule(contact: RuleContact, excluded: Set<number>) {
  return contact.automations_excluded || excluded.has(contact.id)
}
