import { useTranslation } from 'react-i18next'
import { useOutbox } from '../../api/hooks'
import { MessageRow, OpenInWhatsApp } from './BatchStatus'
import { useManualMode } from './useManualMode'

/** Manual mode: every message still waiting to be sent from WhatsApp (reminders, automations, bulk). */
export function OutboxCard() {
  const { t } = useTranslation()
  const manual = useManualMode()
  const { data } = useOutbox(manual)
  if (!manual || !data?.count) return null
  const [next] = data.results
  return (
    <section className="card outbox-card" aria-live="polite">
      <div className="card__header">
        <h2 className="card__title">
          {t('outbox.title')} <span className="outbox-card__count tabular">{data.count}</span>
        </h2>
      </div>
      <div className="card__body stack">
        <p className="field__hint">{t('outbox.hint')}</p>
        <OpenInWhatsApp key={next.id} message={next} label={t('outbox.openNext', { name: next.contact.full_name })} block />
        <ul className="message-list">
          {data.results.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </ul>
      </div>
    </section>
  )
}
