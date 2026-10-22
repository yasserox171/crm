import { ArrowDown, ArrowUp, CheckCircle2, ChevronRight, CircleAlert, MessageCircle, MinusCircle, Plus, Search, SearchX, ShieldCheck, UsersRound, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../../api/client'
import { useContacts, useContactStats } from '../../api/hooks'
import { CONTACT_SOURCES, CONTACT_STATUSES, type Contact, type ContactSelection } from '../../api/types'
import { SendMessageModal } from '../../components/messaging/SendMessageModal'
import { Avatar } from '../../components/ui/Avatar'
import { SourceTag, StatusBadge } from '../../components/ui/Badges'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Checkbox, Input, Select } from '../../components/ui/Form'
import { Pagination } from '../../components/ui/Pagination'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { formatDate, formatNumber, parseLocalDate } from '../../lib/format'
import { ContactFormModal } from './ContactFormModal'

const PAGE_SIZE = 25

/** Selected contacts: explicit ids, or every contact matching the filters it was made under. */
interface Selection {
  filterKey: string
  ids: Set<number>
  allMatching: boolean
}

export default function ContactsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const source = params.get('source') ?? ''
  const ordering = params.get('ordering') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)

  const [searchDraft, setSearchDraft] = useState(search)
  const [formOpen, setFormOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const searchTimer = useRef<number | undefined>(undefined)

  // Changing the search or a filter starts a fresh selection; paging keeps it.
  const filterKey = JSON.stringify([search, status, source])
  const [selectionState, setSelectionState] = useState<Selection>({ filterKey, ids: new Set(), allMatching: false })
  const selection: Selection =
    selectionState.filterKey === filterKey ? selectionState : { filterKey, ids: new Set(), allMatching: false }
  const setSelection = (ids: Set<number>, allMatching = false) => setSelectionState({ filterKey, ids, allMatching })

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )

  const onSearchChange = (value: string) => {
    setSearchDraft(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => update({ q: value.trim() || null, page: null }), 300)
  }

  const list = useContacts({ search, status, source, ordering, page })
  const stats = useContactStats({ search, source })
  const contacts = list.data?.results ?? []
  const hasFilters = Boolean(search || status || source)
  const totalAll = stats.data ? Object.values(stats.data.by_status).reduce((sum, n) => sum + n, 0) : undefined

  const matchingTotal = list.data?.count ?? 0
  const pageIds = contacts.map((contact) => contact.id)
  const isSelected = (id: number) => selection.allMatching || selection.ids.has(id)
  const pageAllSelected = pageIds.length > 0 && pageIds.every(isSelected)
  const pageSomeSelected = !pageAllSelected && pageIds.some(isSelected)
  const selectedCount = selection.allMatching ? matchingTotal : selection.ids.size

  const toggleRow = (id: number) => {
    if (selection.allMatching) {
      setSelection(new Set(pageIds.filter((pageId) => pageId !== id)))
      return
    }
    const ids = new Set(selection.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    setSelection(ids)
  }

  const togglePage = () => {
    if (pageAllSelected) {
      if (selection.allMatching) setSelection(new Set())
      else setSelection(new Set([...selection.ids].filter((id) => !pageIds.includes(id))))
    } else {
      setSelection(new Set([...selection.ids, ...pageIds]))
    }
  }

  const clearSelection = () => setSelection(new Set())
  const recipients: ContactSelection = selection.allMatching
    ? { filters: { search, status, source } }
    : { contact_ids: [...selection.ids] }

  const clearFilters = () => {
    setSearchDraft('')
    update({ q: null, status: null, source: null, page: null })
  }

  const sortHeader = (field: 'first_name' | 'registered_at', label: string) => {
    const active = ordering === field || ordering === `-${field}` || (!ordering && field === 'registered_at')
    const descending = ordering === `-${field}` || (!ordering && field === 'registered_at')
    const nextOrdering = active && !descending ? `-${field}` : field
    return (
      <th aria-sort={active ? (descending ? 'descending' : 'ascending') : undefined}>
        <button
          type="button"
          className="table__sort"
          onClick={() => update({ ordering: nextOrdering === '-registered_at' ? null : nextOrdering, page: null })}
          title={t('contacts.sortBy', { column: label })}
        >
          {label}
          {active && (descending ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />)}
        </button>
      </th>
    )
  }

  return (
    <div className="page page--wide">
      <header className="page__header page__header--hide-title-mobile">
        <div className="page__heading">
          <h1 className="page__title">{t('contacts.title')}</h1>
          {totalAll !== undefined && <p className="page__subtitle">{t('contacts.count', { count: totalAll })}</p>}
        </div>
        <div className="page__actions">
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setFormOpen(true)}>
            {t('contacts.add')}
          </Button>
        </div>
      </header>

      <div className="toolbar">
        <div className="input-group toolbar__search">
          <Search className="input-group__icon" aria-hidden />
          <Input
            type="search"
            className="input--with-icon"
            placeholder={t('contacts.searchPlaceholder')}
            aria-label={t('common.search')}
            value={searchDraft}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <Select
          className="toolbar__select"
          aria-label={t('source.label')}
          value={source}
          onChange={(event) => update({ source: event.target.value || null, page: null })}
        >
          <option value="">{t('source.all')}</option>
          {CONTACT_SOURCES.map((value) => (
            <option key={value} value={value}>
              {t(`source.${value}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="filter-chips" role="group" aria-label={t('contacts.filterStatus')}>
        <button type="button" className="filter-chip" aria-pressed={!status} onClick={() => update({ status: null, page: null })}>
          {t('common.all')}
          {stats.data && <span className="filter-chip__count">{formatNumber(stats.data.total)}</span>}
        </button>
        {CONTACT_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            className="filter-chip"
            aria-pressed={status === value}
            onClick={() => update({ status: status === value ? null : value, page: null })}
          >
            <span className={`badge__dot status-dot--${value}`} aria-hidden />
            {t(`status.${value}`)}
            {stats.data && <span className="filter-chip__count">{formatNumber(stats.data.by_status[value])}</span>}
          </button>
        ))}
      </div>

      <section className="card contacts-card" aria-busy={list.isFetching} data-stale={list.isPlaceholderData || undefined}>
        {list.isError ? (
          <div className="card__body">
            <div className="banner banner--danger" role="alert">
              <CircleAlert aria-hidden />
              <span className="banner__text">{errorMessage(list.error)}</span>
              <Button size="sm" onClick={() => list.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          </div>
        ) : list.isPending ? (
          <ContactsSkeleton />
        ) : contacts.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<SearchX />}
              title={t('contacts.noResultsTitle')}
              text={t('contacts.noResultsText')}
              action={<Button onClick={clearFilters}>{t('common.clearFilters')}</Button>}
            />
          ) : (
            <EmptyState
              icon={<UsersRound />}
              title={t('contacts.emptyTitle')}
              text={t('contacts.emptyText')}
              action={
                <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setFormOpen(true)}>
                  {t('contacts.add')}
                </Button>
              }
            />
          )
        ) : (
          <>
            {pageAllSelected && matchingTotal > pageIds.length && (
              <div className="select-all-banner" role="status">
                {selection.allMatching ? (
                  <>
                    <span>{t('bulk.allMatchingSelected', { count: matchingTotal })}</span>
                    <button type="button" className="text-btn" onClick={clearSelection}>
                      {t('bulk.clear')}
                    </button>
                  </>
                ) : (
                  <>
                    <span>{t('bulk.pageSelected', { count: pageIds.length })}</span>
                    <button type="button" className="text-btn" onClick={() => setSelection(new Set(), true)}>
                      {t('bulk.selectAllMatching', { count: matchingTotal })}
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="table-wrap hide-mobile">
              <table className="table table--clickable contacts-table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <Checkbox
                        checked={pageAllSelected}
                        indeterminate={pageSomeSelected}
                        onChange={togglePage}
                        aria-label={t('bulk.selectPage')}
                      />
                    </th>
                    {sortHeader('first_name', t('contacts.columns.name'))}
                    <th>{t('contacts.columns.phone')}</th>
                    <th>{t('contacts.columns.city')}</th>
                    <th>{t('contacts.columns.subject')}</th>
                    <th>{t('contacts.columns.level')}</th>
                    <th>{t('contacts.columns.status')}</th>
                    <th>{t('contacts.columns.source')}</th>
                    {sortHeader('registered_at', t('contacts.columns.registered'))}
                    <th className="col-center col-icon" title={t('contacts.columns.consent')}>
                      <ShieldCheck aria-hidden />
                      <span className="sr-only">{t('contacts.columns.consent')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id} aria-selected={isSelected(contact.id)} onClick={() => navigate(`/contacts/${contact.id}`)}>
                      <td className="col-check" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={isSelected(contact.id)}
                          onChange={() => toggleRow(contact.id)}
                          aria-label={t('bulk.selectRow', { name: contact.full_name })}
                        />
                      </td>
                      <td>
                        <Link to={`/contacts/${contact.id}`} className="contact-cell" onClick={(event) => event.stopPropagation()}>
                          <span className="contact-cell__text">
                            <span className="contact-cell__name">{contact.full_name}</span>
                            {contact.tags.length > 0 && <span className="contact-cell__tags" title={contact.tags.join(' · ')}>
                                {contact.tags.join(' · ')}
                              </span>}
                          </span>
                        </Link>
                      </td>
                      <td className="nowrap">
                        <PhoneNumber value={contact.phone} />
                      </td>
                      <td>{contact.city || t('common.none')}</td>
                      <td>{contact.subject || t('common.none')}</td>
                      <td>{contact.level ? t(`level.${contact.level}`) : t('common.none')}</td>
                      <td>
                        <StatusBadge status={contact.status} />
                      </td>
                      <td>
                        <SourceTag source={contact.source} />
                      </td>
                      <td className="nowrap tabular">{formatDate(parseLocalDate(contact.registered_at))}</td>
                      <td className="col-center">
                        <ConsentIcon consent={contact.consent} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="select-bar show-mobile">
              <label className="check-label">
                <Checkbox checked={pageAllSelected} indeterminate={pageSomeSelected} onChange={togglePage} />
                <span>{t('bulk.selectPage')}</span>
              </label>
            </div>
            <ul className="contact-cards show-mobile">
              {contacts.map((contact) => (
                <li key={contact.id} className={`contact-card-row${isSelected(contact.id) ? ' contact-card-row--selected' : ''}`}>
                  <Checkbox
                    className="contact-card-row__check"
                    checked={isSelected(contact.id)}
                    onChange={() => toggleRow(contact.id)}
                    aria-label={t('bulk.selectRow', { name: contact.full_name })}
                  />
                  <ContactCard contact={contact} />
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} onPage={(next) => update({ page: next > 1 ? String(next) : null })} />
          </>
        )}
      </section>

      {selectedCount > 0 && (
        <div className="bulk-bar" role="region" aria-label={t('bulk.selected', { count: selectedCount })}>
          <span className="bulk-bar__count">{t('bulk.selected', { count: selectedCount })}</span>
          <div className="bulk-bar__actions">
            <Button variant="ghost" icon={<X aria-hidden />} onClick={clearSelection}>
              <span className="hide-mobile">{t('bulk.clear')}</span>
            </Button>
            <Button variant="primary" icon={<MessageCircle aria-hidden />} onClick={() => setComposeOpen(true)}>
              {t('bulk.sendWhatsapp')}
            </Button>
          </div>
        </div>
      )}

      <SendMessageModal open={composeOpen} onClose={() => setComposeOpen(false)} selection={recipients} onSent={clearSelection} />

      <ContactFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(contact) => navigate(`/contacts/${contact.id}`)}
      />
    </div>
  )
}

function ConsentIcon({ consent }: { consent: boolean }) {
  const { t } = useTranslation()
  const label = consent ? t('contacts.consentYes') : t('contacts.consentNo')
  return (
    <span className={`consent-icon consent-icon--${consent ? 'yes' : 'no'}`} title={label}>
      {consent ? <CheckCircle2 aria-hidden /> : <MinusCircle aria-hidden />}
      <span className="sr-only">{label}</span>
    </span>
  )
}

function ContactCard({ contact }: { contact: Contact }) {
  const { t } = useTranslation()
  const details = [contact.subject, contact.level ? t(`level.${contact.level}`) : '', contact.city].filter(Boolean)
  return (
    <Link to={`/contacts/${contact.id}`} className="contact-card">
      <div className="contact-card__top">
        <Avatar name={contact.full_name} />
        <div className="contact-card__identity">
          <span className="contact-card__name">{contact.full_name}</span>
          <PhoneNumber value={contact.phone} className="muted" />
        </div>
        <StatusBadge status={contact.status} />
      </div>
      {details.length > 0 && <p className="contact-card__details">{details.join(' · ')}</p>}
      <div className="contact-card__meta">
        <SourceTag source={contact.source} />
        <span className="subtle tabular">{formatDate(parseLocalDate(contact.registered_at))}</span>
        <ConsentIcon consent={contact.consent} />
        <ChevronRight className="contact-card__chevron flip-rtl" aria-hidden />
      </div>
    </Link>
  )
}

function ContactsSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton skeleton--avatar" />
          <span className="skeleton" style={{ inlineSize: '22%' }} />
          <span className="skeleton" style={{ inlineSize: '16%' }} />
          <span className="skeleton" style={{ inlineSize: '12%' }} />
          <span className="skeleton" style={{ inlineSize: '10%' }} />
        </div>
      ))}
    </div>
  )
}
