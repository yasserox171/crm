import { FlaskConical, Hand, Smartphone, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useSettings, useWhatsAppStatus } from '../../api/hooks'
import { formatPhone } from '../../lib/phone'
import { buttonClass } from '../ui/buttonClass'

/** Explains how messages leave the CRM when the official WhatsApp API isn't connected. */
export function MessagingModeBanner() {
  const { t } = useTranslation()
  const { data } = useSettings()
  const web = data?.messaging_mode === 'web'
  const status = useWhatsAppStatus(web).data
  if (!data || data.messaging_mode === 'live') return null

  if (web) {
    if (status?.state === 'connected') {
      return (
        <div className="banner banner--info page-banner" role="status">
          <Smartphone aria-hidden />
          <span className="banner__text">
            {t('common.whatsappWebConnected', {
              phone: status.me?.phone ? formatPhone(`+${status.me.phone}`) : '',
              sent: status.sent_today,
              limit: status.daily_limit,
              min: status.min_delay,
              max: status.max_delay,
            })}
          </span>
        </div>
      )
    }
    return (
      <div className="banner banner--warning page-banner" role="status">
        <TriangleAlert aria-hidden />
        <span className="banner__text">{t('common.whatsappWebDisconnected')}</span>
        <Link to="/whatsapp" className={buttonClass({ size: 'sm' })}>
          {t('common.connectWhatsapp')}
        </Link>
      </div>
    )
  }

  const manual = data.messaging_mode === 'manual'
  return (
    <div className="banner banner--info page-banner" role="status">
      {manual ? <Hand aria-hidden /> : <FlaskConical aria-hidden />}
      <span className="banner__text">{manual ? t('common.whatsappManualMode') : t('common.whatsappTestMode')}</span>
    </div>
  )
}
