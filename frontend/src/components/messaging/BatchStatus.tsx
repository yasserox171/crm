import { MessageCircle, RotateCw, Undo2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { errorMessage } from '../../api/client'
import { useBatch, useCancelMessage, useMarkPending, useMarkSent, useRetryMessage, useWhatsAppStatus } from '../../api/hooks'
import type { Message } from '../../api/types'
import { formatDateTime, formatRelative, formatTime } from '../../lib/format'
import { whatsappLink } from '../../lib/phone'
import { DeliveryBadge } from '../ui/Badges'
import { Button } from '../ui/Button'
import { buttonClass } from '../ui/buttonClass'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import { useManualMode } from './useManualMode'
import { useWebMode } from './useWebMode'

const CANCELLED = 'cancelled'

/**
 * Manual mode: a link that opens WhatsApp with the message pre-filled and records it as sent.
 * A plain <a> (not window.open) so phones open the WhatsApp app and nothing is popup-blocked.
 */
export function OpenInWhatsApp({ message, label, block = false }: { message: Message; label: string; block?: boolean }) {
  const toast = useToast()
  const markSent = useMarkSent()
  return (
    <a
      className={buttonClass({ variant: 'primary', size: 'sm', block })}
      href={whatsappLink(message.contact.phone, message.body)}
      target="_blank"
      rel="noreferrer"
      onClick={() => markSent.mutate(message.id, { onError: (error) => toast.error(errorMessage(error)) })}
    >
      <MessageCircle aria-hidden />
      {label}
    </a>
  )
}

interface BatchStatusPanelProps {
  batchId: string
  onDismiss?: () => void
  /** Inside a modal: no card chrome. */
  embedded?: boolean
}

/** Live sent / pending / failed status of one sending batch (polls until done). */
export function BatchStatusPanel({ batchId, onDismiss, embedded = false }: BatchStatusPanelProps) {
  const { t } = useTranslation()
  const manual = useManualMode()
  const web = useWebMode()
  const waStatus = useWhatsAppStatus(web).data
  const { data } = useBatch(batchId)
  if (!data) {
    return (
      <section className={embedded ? undefined : 'card'}>
        <div className="page-loader" style={{ minBlockSize: 120 }}>
          <Spinner label={t('common.loading')} />
        </div>
      </section>
    )
  }
  const total = data.messages.length || 1
  const running = data.counts.pending > 0
  const next = data.messages.find((message) => message.delivery_status === 'pending')
  const title = manual
    ? running
      ? t('outbox.title')
      : t('outbox.allSent')
    : running
      ? t('reminders.statusRunning')
      : t('reminders.statusDone')

  return (
    <section className={embedded ? 'batch-panel batch-panel--embedded' : 'card batch-panel'} aria-live="polite">
      <div className="card__header">
        <h2 className="card__title row">
          {running && !manual && <Spinner />}
          {title}
        </h2>
        {onDismiss && (
          <Button size="sm" variant="ghost" iconOnly label={t('reminders.dismiss')} icon={<X aria-hidden />} onClick={onDismiss} />
        )}
      </div>
      <div className="card__body stack">
        {manual && running && <p className="field__hint">{t('outbox.hint')}</p>}
        {web && running && (
          <p className="field__hint">
            {waStatus?.state === 'connected'
              ? t('outbox.progressive', { min: waStatus.min_delay, max: waStatus.max_delay })
              : t('common.whatsappWebDisconnected')}
          </p>
        )}
        <div className="progress" role="img" aria-label={t('reminders.statusTitle')}>
          {(['sent', 'failed', 'pending'] as const).map((status) => (
            <span key={status} className={`progress__bar progress__bar--${status}`} style={{ inlineSize: `${(data.counts[status] / total) * 100}%` }} />
          ))}
        </div>
        <div className="batch-counts">
          {(['sent', 'pending', 'failed'] as const).map((status) => (
            <span key={status} className="batch-counts__item">
              <DeliveryBadge status={status} manual={manual} />
              <strong className="tabular">{data.counts[status]}</strong>
            </span>
          ))}
        </div>
        {manual && next && (
          <OpenInWhatsApp key={next.id} message={next} label={t('outbox.openNext', { name: next.contact.full_name })} block />
        )}
        <ul className="message-list">
          {data.messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </ul>
      </div>
    </section>
  )
}

export function MessageRow({ message }: { message: Message }) {
  const { t } = useTranslation()
  const toast = useToast()
  const manual = useManualMode()
  const retry = useRetryMessage()
  const cancel = useCancelMessage()
  const markPending = useMarkPending()
  const onError = (error: unknown) => toast.error(errorMessage(error))
  const cancelled = message.delivery_status === 'failed' && message.error === CANCELLED

  return (
    <li className="message-row">
      <div className="message-row__main">
        <Link to={`/contacts/${message.contact.id}`} className="message-row__name">
          {message.contact.full_name}
        </Link>
        <span className="subtle tabular message-row__time">
          {message.delivery_status === 'sent' && message.sent_at
            ? t('reminders.sentAt', { time: formatTime(message.sent_at) })
            : t('reminders.queuedAt', { time: formatRelative(message.created_at) })}
          {message.appointment_at && ` · ${formatDateTime(message.appointment_at)}`}
        </span>
        {message.error && !cancelled && (
          <span className="field__error">{message.error === 'not_on_whatsapp' ? t('delivery.notOnWhatsapp') : message.error}</span>
        )}
      </div>
      {cancelled ? (
        <span className="badge badge--draft">
          <span className="badge__dot" aria-hidden />
          {t('delivery.cancelled')}
        </span>
      ) : (
        !(manual && message.delivery_status === 'pending') && <DeliveryBadge status={message.delivery_status} manual={manual} />
      )}
      {manual && message.delivery_status === 'pending' && (
        <>
          <OpenInWhatsApp message={message} label={t('outbox.open')} />
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={t('outbox.skip')}
            icon={<X aria-hidden />}
            loading={cancel.isPending}
            onClick={() => cancel.mutate(message.id, { onError })}
          />
        </>
      )}
      {message.sent_manually && message.delivery_status === 'sent' && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={t('outbox.undo')}
          icon={<Undo2 aria-hidden />}
          loading={markPending.isPending}
          onClick={() => markPending.mutate(message.id, { onError })}
        />
      )}
      {message.delivery_status === 'failed' && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={cancelled ? t('outbox.restore') : t('common.retry')}
          icon={<RotateCw aria-hidden />}
          loading={retry.isPending}
          onClick={() =>
            retry.mutate(message.id, {
              onSuccess: () => toast.success(t('reminders.retried')),
              onError,
            })
          }
        />
      )}
    </li>
  )
}
