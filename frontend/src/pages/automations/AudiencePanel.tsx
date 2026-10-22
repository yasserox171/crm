import { MessageCircle, RefreshCw, Search, Tag, UserCheck, UserX, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { errorMessage } from '../../api/client'
import { useAutomationAudience, useContactSearch } from '../../api/hooks'
import type { Action, AudienceContact } from '../../api/types'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Form'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { PageLoader } from '../../components/ui/Spinner'
import { formatDate, formatDateTime, formatRelative } from '../../lib/format'
import { useDebounce } from '../../lib/useDebounce'
import { matchContact } from './matchContact'
import { useExclusionToggle } from './useExclusionToggle'

const ACTION_ICONS: Record<Action, LucideIcon> = { send_whatsapp: MessageCircle, change_status: RefreshCw, add_tag: Tag }

type Tab = 'upcoming' | 'excluded'

/** "Contacts concernés": who the active rules are about to act on, and who is excluded from them. */
export function AudiencePanel() {
  const { t } = useTranslation()
  const audience = useAutomationAudience()
  const { toggle, busyId } = useExclusionToggle()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const data = audience.data

  const upcoming = (data?.upcoming ?? []).filter((item) => matchContact(item.contact, needle))
  const excludeButton = (contact: AudienceContact) => (
    <Button
      size="sm"
      icon={<UserX aria-hidden />}
      loading={busyId === contact.id}
      aria-label={t('audience.excludeLabel', { name: contact.full_name })}
      onClick={() => toggle(contact, true)}
    >
      <span className="hide-mobile">{t('audience.exclude')}</span>
    </Button>
  )

  return (
    <section className="card audience" aria-labelledby="audience-title">
      <div className="card__header">
        <div>
          <h2 id="audience-title" className="card__title">
            {t('audience.title')}
          </h2>
          <p className="subtle audience__subtitle">{t('audience.subtitle')}</p>
        </div>
      </div>
      <div className="card__body stack">
        <div className="audience__toolbar">
          <SegmentedControl<Tab>
            label={t('audience.title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'upcoming', label: <TabLabel text={t('audience.upcoming')} count={data?.upcoming_total} /> },
              { value: 'excluded', label: <TabLabel text={t('audience.excluded')} count={data?.excluded_total} /> },
            ]}
          />
          {tab === 'upcoming' && (
            <div className="input-group audience__search">
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
          )}
        </div>

        {!data ? (
          audience.isError ? (
            <p className="field__error">{errorMessage(audience.error)}</p>
          ) : (
            <PageLoader />
          )
        ) : tab === 'upcoming' ? (
          <>
            {upcoming.length > 0 ? (
              <ul className="audience-list">
                {upcoming.map(({ contact, actions }) => (
                  <AudienceRow key={contact.id} contact={contact} action={excludeButton(contact)}>
                    <ul className="audience-row__actions">
                      {actions.map((planned) => {
                        const Icon = ACTION_ICONS[planned.action]
                        return (
                          <li key={`${planned.rule}-${planned.due_at}`} title={`${planned.rule_name} — ${formatDateTime(planned.due_at)}`}>
                            <Icon aria-hidden />
                            <bdi>{planned.rule_name}</bdi>
                            <span className="tabular">· {formatRelative(planned.due_at)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </AudienceRow>
                ))}
              </ul>
            ) : needle ? (
              <p className="subtle audience__empty">{t('audience.noMatch', { query: query.trim() })}</p>
            ) : (
              <div className="audience__empty">
                <p>{t('audience.emptyUpcoming')}</p>
                <p className="subtle">{t('audience.emptyUpcomingHint')}</p>
              </div>
            )}
            {data.upcoming_total > data.upcoming.length && (
              <p className="subtle audience__more">{t('audience.truncated', { shown: data.upcoming.length, total: data.upcoming_total })}</p>
            )}
          </>
        ) : (
          <>
            {data.excluded.length > 0 ? (
              <ul className="audience-list">
                {data.excluded.map((contact) => (
                  <AudienceRow
                    key={contact.id}
                    contact={contact}
                    action={
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<UserCheck aria-hidden />}
                        loading={busyId === contact.id}
                        aria-label={t('audience.restoreLabel', { name: contact.full_name })}
                        onClick={() => toggle(contact, false)}
                      >
                        <span className="hide-mobile">{t('audience.restore')}</span>
                      </Button>
                    }
                  >
                    {contact.excluded_at && (
                      <span className="subtle audience-row__meta">{t('audience.excludedSince', { date: formatDate(contact.excluded_at) })}</span>
                    )}
                  </AudienceRow>
                ))}
              </ul>
            ) : (
              <p className="subtle audience__empty">{t('audience.emptyExcluded')}</p>
            )}
            <ExcludeOther renderAction={excludeButton} />
          </>
        )}

        <p className="field__hint">{t('audience.note')}</p>
      </div>
    </section>
  )
}

function TabLabel({ text, count }: { text: string; count?: number }) {
  return (
    <>
      {text}
      {count !== undefined && <span className="audience__count tabular">{count}</span>}
    </>
  )
}

function AudienceRow({ contact, action, children }: { contact: AudienceContact; action: ReactNode; children?: ReactNode }) {
  return (
    <li className="audience-row">
      <Avatar name={contact.full_name} />
      <div className="audience-row__main">
        <Link to={`/contacts/${contact.id}`} className="audience-row__name">
          <bdi>{contact.full_name}</bdi>
        </Link>
        <PhoneNumber value={contact.phone} className="subtle audience-row__phone" />
        {children}
      </div>
      {action}
    </li>
  )
}

/** Exclude a contact no rule is about to reach yet (staff, family, test numbers…). */
function ExcludeOther({ renderAction }: { renderAction: (contact: AudienceContact) => ReactNode }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const search = useDebounce(query.trim(), 300)
  const results = useContactSearch(search)
  const found = search.length >= 2 ? results.data?.results : undefined

  return (
    <div className="audience__add">
      <h3 className="audience__add-title">{t('audience.addTitle')}</h3>
      <div className="input-group">
        <Search className="input-group__icon" aria-hidden />
        <Input
          type="search"
          className="input--with-icon"
          placeholder={t('audience.addPlaceholder')}
          aria-label={t('audience.addTitle')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {found &&
        (found.length === 0 ? (
          <p className="subtle audience__empty">{t('audience.noMatch', { query: search })}</p>
        ) : (
          <ul className="audience-list">
            {found.map((contact) => (
              <AudienceRow
                key={contact.id}
                contact={contact}
                action={contact.automations_excluded ? <span className="badge badge--draft">{t('audience.alreadyExcluded')}</span> : renderAction(contact)}
              />
            ))}
          </ul>
        ))}
    </div>
  )
}
