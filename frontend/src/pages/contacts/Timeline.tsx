import { ArrowRightLeft, CalendarClock, MessageCircle, Phone, Send, StickyNote, UserPlus } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../api/client'
import { useAddNote, useTimeline } from '../../api/hooks'
import { CONTACT_STATUSES, type ContactStatus, type Interaction } from '../../api/types'
import { DeliveryBadge } from '../../components/ui/Badges'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Form'
import { Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatDateTime, formatDayLabel, formatTime, toDateInput } from '../../lib/format'

const isStatus = (value: unknown): value is ContactStatus => CONTACT_STATUSES.includes(value as ContactStatus)

export function NoteComposer({ contactId }: { contactId: number }) {
  const { t } = useTranslation()
  const toast = useToast()
  const addNote = useAddNote(contactId)
  const [body, setBody] = useState('')

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!body.trim() || addNote.isPending) return
    addNote.mutate(body.trim(), {
      onSuccess: () => {
        setBody('')
        toast.success(t('timeline.noteAdded'))
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit()
  }

  return (
    <form className="note-composer" onSubmit={submit}>
      <Textarea
        dir="auto"
        aria-label={t('timeline.notePlaceholder')}
        placeholder={t('timeline.notePlaceholder')}
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={5000}
      />
      <div className="note-composer__footer">
        <span className="field__hint hide-mobile">{t('timeline.shortcut')}</span>
        <Button type="submit" variant="primary" size="sm" icon={<Send className="flip-rtl" aria-hidden />} loading={addNote.isPending} disabled={!body.trim()}>
          {t('timeline.addNote')}
        </Button>
      </div>
    </form>
  )
}

export function Timeline({ contactId }: { contactId: number }) {
  const { t } = useTranslation()
  const { data, isPending, isError, error } = useTimeline(contactId)

  if (isPending) {
    return (
      <div className="page-loader" style={{ minBlockSize: 120 }}>
        <Spinner label={t('common.loading')} />
      </div>
    )
  }
  if (isError) return <p className="field__error">{errorMessage(error)}</p>
  if (!data.length) return <p className="muted timeline__empty">{t('timeline.empty')}</p>

  const groups: { day: string; items: Interaction[] }[] = []
  for (const item of data) {
    const day = toDateInput(new Date(item.created_at))
    const group = groups[groups.length - 1]
    if (group?.day === day) group.items.push(item)
    else groups.push({ day, items: [item] })
  }

  return (
    <div className="timeline">
      {groups.map((group) => (
        <section key={group.day} className="timeline__group">
          <h3 className="timeline__day">{formatDayLabel(new Date(group.items[0].created_at), { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
          <ol className="timeline__list">
            {group.items.map((item) => (
              <TimelineItem key={item.id} item={item} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function TimelineItem({ item }: { item: Interaction }) {
  const { t } = useTranslation()
  const { icon, tone, title } = describe(item, t)
  const isMessage = item.kind === 'whatsapp_out' || item.kind === 'whatsapp_in'

  return (
    <li className="timeline-item">
      <span className={`timeline-item__icon timeline-item__icon--${tone}`} aria-hidden>
        {icon}
      </span>
      <div className="timeline-item__content">
        <div className="timeline-item__head">
          <span className="timeline-item__title">{title}</span>
          {item.purpose && <span className="badge badge--accent">{t(`timeline.purpose_${item.purpose}`)}</span>}
          {item.delivery_status && <DeliveryBadge status={item.delivery_status} />}
          <time className="timeline-item__time subtle tabular" dateTime={item.created_at} title={formatDateTime(item.created_at)}>
            {formatTime(item.created_at)}
          </time>
        </div>
        {item.body && item.kind !== 'appointment' && (
          <p dir="auto" className={isMessage ? `bubble bubble--${item.kind === 'whatsapp_out' ? 'out' : 'in'}` : 'timeline-item__body'}>
            {item.body}
          </p>
        )}
        {item.error && <p className="field__error">{item.error}</p>}
        {(item.created_by_name || item.rule_name) && (
          <p className="timeline-item__meta subtle">
            {item.rule_name ? t('timeline.viaRule', { name: item.rule_name }) : t('common.by', { name: item.created_by_name })}
          </p>
        )}
      </div>
    </li>
  )
}

type TFn = ReturnType<typeof useTranslation>['t']

function describe(item: Interaction, t: TFn) {
  const meta = item.metadata
  switch (item.kind) {
    case 'note':
      return { icon: <StickyNote />, tone: 'note', title: t('timeline.note') }
    case 'call':
      return { icon: <Phone />, tone: 'neutral', title: t('timeline.call') }
    case 'whatsapp_out':
      return { icon: <MessageCircle />, tone: 'whatsapp', title: t('timeline.whatsapp_out') }
    case 'whatsapp_in':
      return { icon: <MessageCircle />, tone: 'neutral', title: t('timeline.whatsapp_in') }
    case 'appointment': {
      const date = meta.scheduled_at ? formatDateTime(meta.scheduled_at) : ''
      const event = meta.event ?? 'created'
      const title =
        event === 'created'
          ? t('timeline.appointment_created', { date })
          : event === 'rescheduled'
            ? t('timeline.appointment_rescheduled', { date })
            : event === 'attended'
              ? t('timeline.appointment_attended')
              : event === 'no_show'
                ? t('timeline.appointment_no_show')
                : event === 'cancelled'
                  ? t('timeline.appointment_cancelled')
                  : t('timeline.appointment_scheduled', { date })
      return { icon: <CalendarClock />, tone: 'appointment', title: item.body ? `${title} — ${item.body}` : title }
    }
    case 'status_change':
      if (meta.event === 'created') {
        return {
          icon: <UserPlus />,
          tone: 'accent',
          title: t('timeline.created', { source: meta.source ? t(`source.${meta.source}`) : '' }),
        }
      }
      return {
        icon: <ArrowRightLeft />,
        tone: 'accent',
        title: t('timeline.statusChange', {
          from: isStatus(meta.from) ? t(`status.${meta.from}`) : '',
          to: isStatus(meta.to) ? t(`status.${meta.to}`) : '',
        }),
      }
  }
}
