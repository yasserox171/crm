import { BellRing, CalendarX2, ChevronLeft, ChevronRight, CircleAlert, Send, ShieldOff } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { errorMessage } from '../../api/client'
import {
  useAppointments,
  useMessages,
  useReminderPreview,
  useSendReminders,
  useSettings,
  useUpdateSettings,
} from '../../api/hooks'
import type { Appointment, Locale } from '../../api/types'
import { BatchStatusPanel, MessageRow } from '../../components/messaging/BatchStatus'
import { useManualMode } from '../../components/messaging/useManualMode'
import { OutboxCard } from '../../components/messaging/OutboxCard'
import { Button } from '../../components/ui/Button'
import { buttonClass } from '../../components/ui/buttonClass'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Checkbox, Select, Textarea } from '../../components/ui/Form'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Spinner } from '../../components/ui/Spinner'
import { MessagingModeBanner } from '../../components/messaging/MessagingModeBanner'
import { useToast } from '../../components/ui/Toast'
import { addDays, formatDateTime, formatDayLabel, formatRelative, formatTime, startOfDay } from '../../lib/format'
import { useDebounce } from '../../lib/useDebounce'

type Range = 'today' | 'tomorrow' | 'week'
const VARIABLES = ['first_name', 'full_name', 'date', 'time', 'title'] as const

function rangeParams(range: Range) {
  const today = startOfDay(new Date())
  if (range === 'today') return { upcoming: true, end: addDays(today, 1).toISOString() }
  if (range === 'tomorrow') return { upcoming: true, start: addDays(today, 1).toISOString(), end: addDays(today, 2).toISOString() }
  return { upcoming: true, end: addDays(today, 7).toISOString() }
}

export default function RemindersPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState<Range>('week')
  const params = useMemo(() => rangeParams(range), [range])
  const appointments = useAppointments(params)
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const send = useSendReminders()
  const manual = useManualMode()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [templateDraft, setTemplateDraft] = useState<string | null>(null)
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const template = templateDraft ?? settings.data?.reminder_template ?? ''
  const locale: Locale = settings.data?.message_locale ?? 'fr'
  const list = appointments.data ?? []
  const eligible = list.filter((appointment) => appointment.contact_detail.consent)
  // Selection only counts appointments visible in the current range.
  const selectedList = list.filter((appointment) => selected.has(appointment.id))
  const selectedIds = selectedList.map((appointment) => appointment.id)
  const allSelected = eligible.length > 0 && selectedList.length === eligible.length
  const someSelected = selectedList.length > 0 && !allSelected

  const debouncedTemplate = useDebounce(template, 400)
  const preview = useReminderPreview(selectedIds, debouncedTemplate, locale)
  const previewMessages = selectedIds.length ? (preview.data?.messages.filter((message) => !message.skipped_reason) ?? []) : []
  const currentPreview = previewMessages[Math.min(previewIndex, Math.max(0, previewMessages.length - 1))]

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(eligible.map((appointment) => appointment.id)))

  const insertVariable = (variable: string) => {
    const token = `{${variable}}`
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? template.length
    const end = textarea?.selectionEnd ?? template.length
    setTemplateDraft(template.slice(0, start) + token + template.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const confirmSend = () =>
    send.mutate(
      { appointment_ids: selectedIds, template, save_template: saveTemplate },
      {
        onSuccess: (result) => {
          setConfirmOpen(false)
          setSelected(new Set())
          setBatchId(result.batch_id)
          if (result.queued) toast.success(manual ? t('compose.ready', { count: result.queued }) : t('reminders.queued', { count: result.queued }))
          if (result.skipped.length) toast.error(t('reminders.skipped', { count: result.skipped.length }))
        },
        onError: (error) => {
          setConfirmOpen(false)
          toast.error(errorMessage(error))
        },
      },
    )

  const canSend = selectedIds.length > 0 && template.trim().length > 0
  const sendLabel = selectedIds.length ? t('reminders.send', { count: selectedIds.length }) : t('reminders.sendNone')

  return (
    <div className="page">
      <header className="page__header page__header--hide-title-mobile">
        <div className="page__heading">
          <h1 className="page__title">{t('reminders.title')}</h1>
          <p className="page__subtitle">{t('reminders.subtitle')}</p>
        </div>
      </header>

      <MessagingModeBanner />
      <OutboxCard />

      <div className="reminders-layout">
        <section className="card reminders-list">
          <div className="card__header reminders-list__header">
            <SegmentedControl<Range>
              label={t('reminders.title')}
              value={range}
              onChange={(value) => {
                setRange(value)
                setPreviewIndex(0)
              }}
              options={[
                { value: 'today', label: t('reminders.range.today') },
                { value: 'tomorrow', label: t('reminders.range.tomorrow') },
                { value: 'week', label: t('reminders.range.week') },
              ]}
            />
          </div>

          {appointments.isError ? (
            <div className="card__body">
              <div className="banner banner--danger" role="alert">
                <CircleAlert aria-hidden />
                <span className="banner__text">{errorMessage(appointments.error)}</span>
              </div>
            </div>
          ) : appointments.isPending ? (
            <div className="page-loader" style={{ minBlockSize: 200 }}>
              <Spinner label={t('common.loading')} />
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={<CalendarX2 />}
              title={t('reminders.emptyTitle')}
              text={t('reminders.emptyText')}
              action={
                <Link to="/contacts" className={buttonClass({ variant: 'secondary' })}>
                  {t('reminders.goToContacts')}
                </Link>
              }
            />
          ) : (
            <>
              <div className="select-bar">
                <label className="check-label">
                  <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} disabled={!eligible.length} />
                  <span>{t('reminders.selectAll')}</span>
                </label>
                <span className="select-bar__count" aria-live="polite">
                  <strong>{t('reminders.selected', { count: selectedIds.length })}</strong>{' '}
                  <span className="subtle">{t('reminders.selectedOf', { total: eligible.length })}</span>
                </span>
              </div>
              <ul className="reminder-rows">
                {list.map((appointment) => (
                  <li key={appointment.id}>
                    <ReminderRow appointment={appointment} checked={selected.has(appointment.id)} onToggle={() => toggle(appointment.id)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <aside className="reminders-side">
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{t('reminders.message')}</h2>
            </div>
            <div className="card__body stack">
              <Textarea
                ref={textareaRef}
                dir="auto"
                aria-label={t('reminders.message')}
                rows={5}
                value={template}
                onChange={(event) => setTemplateDraft(event.target.value)}
                aria-invalid={!template.trim() || undefined}
                maxLength={1000}
              />
              {!template.trim() && <p className="field__error">{t('reminders.templateEmpty')}</p>}
              <div className="variable-chips">
                <span className="subtle">{t('reminders.variables')}</span>
                {VARIABLES.map((variable) => (
                  <button key={variable} type="button" className="filter-chip filter-chip--sm" onClick={() => insertVariable(variable)}>
                    {t(`reminders.var.${variable}`)}
                  </button>
                ))}
              </div>
              <div className="composer-options">
                <label className="composer-options__locale">
                  <span className="subtle">{t('reminders.dateLanguage')}</span>
                  <Select
                    className="select--sm"
                    value={locale}
                    onChange={(event) => updateSettings.mutate({ message_locale: event.target.value as Locale })}
                  >
                    <option value="fr">{t('language.fr')}</option>
                    <option value="ar">{t('language.ar')}</option>
                    <option value="en">{t('language.en')}</option>
                  </Select>
                </label>
                <label className="check-label">
                  <Checkbox checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />
                  <span>{t('reminders.saveTemplate')}</span>
                </label>
              </div>

              <div className="preview">
                <div className="preview__header">
                  <span className="preview__title">
                    {currentPreview?.contact_name ? t('reminders.previewFor', { name: currentPreview.contact_name }) : t('reminders.preview')}
                  </span>
                  {previewMessages.length > 1 && (
                    <div className="row">
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        label={t('reminders.previousRecipient')}
                        icon={<ChevronLeft className="flip-rtl" aria-hidden />}
                        disabled={previewIndex <= 0}
                        onClick={() => setPreviewIndex((index) => index - 1)}
                      />
                      <span className="subtle tabular">
                        {Math.min(previewIndex, previewMessages.length - 1) + 1}/{previewMessages.length}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        label={t('reminders.nextRecipient')}
                        icon={<ChevronRight className="flip-rtl" aria-hidden />}
                        disabled={previewIndex >= previewMessages.length - 1}
                        onClick={() => setPreviewIndex((index) => index + 1)}
                      />
                    </div>
                  )}
                </div>
                <div className="preview__screen">
                  {currentPreview ? (
                    <p className="bubble bubble--out" dir="auto">
                      {currentPreview.body}
                    </p>
                  ) : (
                    <p className="subtle preview__empty">{t('reminders.previewEmpty')}</p>
                  )}
                </div>
              </div>

              <Button variant="primary" block icon={<Send className="flip-rtl" aria-hidden />} disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                {sendLabel}
              </Button>
            </div>
          </section>

          {batchId && <BatchStatusPanel batchId={batchId} onDismiss={() => setBatchId(null)} />}
          <HistoryCard />
        </aside>
      </div>

      {selectedIds.length > 0 && (
        <div className="action-bar show-mobile">
          <span className="action-bar__count">{t('reminders.selected', { count: selectedIds.length })}</span>
          <Button variant="primary" icon={<Send className="flip-rtl" aria-hidden />} disabled={!canSend} onClick={() => setConfirmOpen(true)}>
            {t('reminders.send', { count: selectedIds.length })}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('reminders.confirmTitle', { count: selectedIds.length })}
        description={t('reminders.confirmText')}
        confirmLabel={t('reminders.confirm', { count: selectedIds.length })}
        loading={send.isPending}
        onConfirm={confirmSend}
        onCancel={() => setConfirmOpen(false)}
      >
        <ul className="recipient-list">
          {selectedList.slice(0, 5).map((appointment) => (
            <li key={appointment.id}>
              <span>{appointment.contact_detail.full_name}</span>
              <span className="subtle tabular">{formatDateTime(appointment.scheduled_at)}</span>
            </li>
          ))}
        </ul>
        {selectedList.length > 5 && <p className="subtle">{t('reminders.andMore', { count: selectedList.length - 5 })}</p>}
      </ConfirmDialog>
    </div>
  )
}

function ReminderRow({ appointment, checked, onToggle }: { appointment: Appointment; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const contact = appointment.contact_detail
  const date = new Date(appointment.scheduled_at)
  return (
    <label className={`reminder-row${contact.consent ? '' : ' reminder-row--disabled'}${checked ? ' reminder-row--checked' : ''}`}>
      <Checkbox checked={checked} onChange={onToggle} disabled={!contact.consent} aria-label={contact.full_name} />
      <span className="reminder-row__when">
        <span className="reminder-row__time tabular">{formatTime(date)}</span>
        <span className="subtle">{formatDayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      </span>
      <span className="reminder-row__who">
        <Link to={`/contacts/${contact.id}`} className="reminder-row__name" onClick={(event) => event.stopPropagation()}>
          {contact.full_name}
        </Link>
        <PhoneNumber value={contact.phone} className="subtle" />
      </span>
      <span className="reminder-row__what">
        {appointment.title && (
          <span className="reminder-row__title" dir="auto">
            {appointment.title}
          </span>
        )}
        <span className="reminder-row__badges">
          {!contact.consent && (
            <span className="badge badge--warning">
              <ShieldOff aria-hidden />
              {t('reminders.noConsent')}
            </span>
          )}
          {appointment.last_reminder_at && (
            <span className="badge badge--accent" title={formatDateTime(appointment.last_reminder_at)}>
              <BellRing aria-hidden />
              {t('reminders.alreadyReminded', { time: formatRelative(appointment.last_reminder_at) })}
            </span>
          )}
        </span>
      </span>
    </label>
  )
}

function HistoryCard() {
  const { t } = useTranslation()
  const { data, isPending } = useMessages({ purpose: 'reminder', page_size: 8 })
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{t('reminders.history')}</h2>
      </div>
      <div className="card__body">
        {isPending ? (
          <span className="skeleton" style={{ blockSize: 48 }} />
        ) : !data?.results.length ? (
          <p className="muted">{t('reminders.historyEmpty')}</p>
        ) : (
          <ul className="message-list">
            {data.results.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
