import { Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RuleContact } from '../../api/types'
import { Checkbox, Input } from '../../components/ui/Form'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { formatDateTime, formatRelative } from '../../lib/format'
import { isOutOfRule, matchContact } from './matchContact'

type Filter = 'all' | 'in' | 'out'

interface RuleContactsFieldProps {
  contacts: RuleContact[]
  /** Ids unticked in this rule (form state). */
  excluded: number[]
  onChange: (excluded: number[]) => void
  whatsapp: boolean
}

/** The rule form's "Pour" step: tick the numbers this rule applies to. */
export function RuleContactsField({ contacts, excluded, onChange, whatsapp }: RuleContactsFieldProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const excludedSet = new Set(excluded)
  const isOut = (contact: RuleContact) => isOutOfRule(contact, excludedSet)

  const needle = query.trim().toLowerCase()
  const searched = contacts.filter((contact) => matchContact(contact, needle))
  const visible = searched.filter((contact) => filter === 'all' || (filter === 'out') === isOut(contact))
  const outCount = contacts.filter(isOut).length
  // Contacts excluded from every automation can't be ticked here.
  const switchable = visible.filter((contact) => !contact.automations_excluded).map((contact) => contact.id)

  const setOut = (ids: number[], out: boolean) => {
    const next = new Set(excluded)
    for (const id of ids) {
      if (out) next.add(id)
      else next.delete(id)
    }
    onChange([...next])
  }

  return (
    <div className="rule-contacts">
      <p className="field__hint">{t('rule.contactsHint')}</p>
      <div className="rule-contacts__toolbar">
        <div className="input-group rule-contacts__search">
          <Search className="input-group__icon" aria-hidden />
          <Input
            type="search"
            className="input--with-icon"
            placeholder={t('audience.search')}
            aria-label={t('audience.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SegmentedControl<Filter>
          label={t('rule.contactsTitle')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: <Count text={t('rule.filterAll')} count={contacts.length} /> },
            { value: 'in', label: <Count text={t('rule.filterIncluded')} count={contacts.length - outCount} /> },
            { value: 'out', label: <Count text={t('rule.filterExcluded')} count={outCount} /> },
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <p className="subtle rule-contacts__empty">{needle ? t('audience.noMatch', { query: query.trim() }) : t('rule.noContacts')}</p>
      ) : (
        <ul className="rule-contacts__list">
          {visible.map((contact) => {
            const out = isOut(contact)
            return (
              <li key={contact.id}>
                <label className={`rule-contact${out ? ' rule-contact--out' : ''}`}>
                  <Checkbox
                    checked={!out}
                    disabled={contact.automations_excluded}
                    onChange={(event) => setOut([contact.id], !event.target.checked)}
                  />
                  <span className="rule-contact__main">
                    <bdi className="rule-contact__name">{contact.full_name}</bdi>
                    <PhoneNumber value={contact.phone} className="subtle rule-contact__phone" />
                  </span>
                  {contact.automations_excluded ? (
                    <span className="rule-contact__note">{t('rule.excludedEverywhere')}</span>
                  ) : whatsapp && !contact.consent ? (
                    <span className="rule-contact__note">{t('rule.noConsent')}</span>
                  ) : (
                    !out &&
                    contact.due_at && (
                      <span className="rule-contact__note rule-contact__note--due" title={formatDateTime(contact.due_at)}>
                        {t('rule.plannedAt', { time: formatRelative(contact.due_at) })}
                      </span>
                    )
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      )}

      {switchable.length > 0 && (
        <div className="rule-contacts__bulk">
          <button type="button" className="text-btn" onClick={() => setOut(switchable, false)}>
            {t('rule.checkAll')}
          </button>
          <button type="button" className="text-btn" onClick={() => setOut(switchable, true)}>
            {t('rule.uncheckAll')}
          </button>
        </div>
      )}
    </div>
  )
}

function Count({ text, count }: { text: string; count: number }) {
  return (
    <>
      {text}
      <span className="audience__count tabular">{count}</span>
    </>
  )
}
