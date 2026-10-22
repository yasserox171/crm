import { CircleAlert, CircleCheck, LogOut, ShieldAlert, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../api/client'
import { useSettings, useWhatsAppLogout, useWhatsAppStatus } from '../../api/hooks'
import type { WhatsAppStatus } from '../../api/types'
import { useWebMode } from '../../components/messaging/useWebMode'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { PageLoader, Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'

export default function WhatsAppPage() {
  const { t } = useTranslation()
  const settings = useSettings()
  const web = useWebMode()
  const status = useWhatsAppStatus(web, true)

  if (settings.isPending) return <PageLoader />

  return (
    <div className="page">
      <header className="page__header page__header--hide-title-mobile">
        <div className="page__heading">
          <h1 className="page__title">{t('wa.title')}</h1>
          <p className="page__subtitle">{t('wa.subtitle')}</p>
        </div>
      </header>

      {!web ? (
        <section className="card">
          <EmptyState icon={<Smartphone />} title={t('wa.title')} text={t('wa.disabled')} />
        </section>
      ) : (
        <div className="stack">
          <div className="banner banner--warning" role="note">
            <ShieldAlert aria-hidden />
            <span className="banner__text">
              <strong>{t('wa.riskTitle')}</strong> {t('wa.risk')}
            </span>
          </div>
          <section className="card wa-card">
            {status.isPending ? <PageLoader /> : <ConnectionState status={status.data} />}
          </section>
        </div>
      )}
    </div>
  )
}

function ConnectionState({ status }: { status?: WhatsAppStatus }) {
  const { t } = useTranslation()
  const state = status?.state ?? 'unreachable'

  if (state === 'connected' && status?.me) return <Connected status={status} />

  if (state === 'qr' && status?.qr) {
    return (
      <div className="wa-link">
        <div className="wa-link__qr">
          <img src={status.qr} alt={t('wa.scanTitle')} width={260} height={260} />
          <p className="field__hint">{t('wa.qrRefresh')}</p>
        </div>
        <div className="wa-link__steps">
          <StateBadge state={state} />
          <h2 className="wa-link__title">{t('wa.scanTitle')}</h2>
          <ol>
            <li>{t('wa.step1')}</li>
            <li>{t('wa.step2')}</li>
            <li>{t('wa.step3')}</li>
          </ol>
        </div>
      </div>
    )
  }

  if (state === 'unreachable') {
    return (
      <div className="card__body">
        <div className="banner banner--danger" role="alert">
          <CircleAlert aria-hidden />
          <span className="banner__text">{t('wa.unreachable')}</span>
        </div>
      </div>
    )
  }

  // initializing / disconnected: the service is (re)starting WhatsApp Web.
  return (
    <div className="wa-waiting">
      <Spinner label={t('common.loading')} />
      <StateBadge state={state} />
      <p className="muted">{t('wa.starting')}</p>
    </div>
  )
}

function Connected({ status }: { status: WhatsAppStatus }) {
  const { t } = useTranslation()
  const toast = useToast()
  const logout = useWhatsAppLogout()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const sent = status.sent_today ?? 0
  const limit = status.daily_limit ?? 0
  const pending = status.pending ?? 0

  return (
    <div className="card__body stack">
      <div className="wa-connected">
        <span className="wa-connected__icon" aria-hidden>
          <CircleCheck />
        </span>
        <div className="wa-connected__who">
          <StateBadge state="connected" />
          <strong className="wa-connected__name">{t('wa.connectedAs', { name: status.me?.name || '—' })}</strong>
          {status.me?.phone && <PhoneNumber value={`+${status.me.phone}`} className="muted" />}
        </div>
        <Button variant="secondary" icon={<LogOut className="flip-rtl" aria-hidden />} onClick={() => setConfirmOpen(true)}>
          {t('wa.logout')}
        </Button>
      </div>

      <div className="wa-usage">
        <div className="row row--between">
          <span>{t('wa.usage', { sent, limit })}</span>
          {pending > 0 && <span className="badge badge--pending">{t('wa.pending', { count: pending })}</span>}
        </div>
        <div className="progress" role="img" aria-label={t('wa.usage', { sent, limit })}>
          <span className="progress__bar progress__bar--sent" style={{ inlineSize: `${limit ? Math.min(100, (sent / limit) * 100) : 0}%` }} />
        </div>
        <p className="field__hint">{t('wa.pacing', { min: status.min_delay, max: status.max_delay, limit })}</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('wa.logout')}
        description={t('wa.logoutConfirm')}
        confirmLabel={t('wa.logout')}
        variant="danger"
        loading={logout.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          logout.mutate(undefined, {
            onSuccess: () => {
              setConfirmOpen(false)
              toast.success(t('wa.loggedOut'))
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

function StateBadge({ state }: { state: NonNullable<WhatsAppStatus['state']> }) {
  const { t } = useTranslation()
  const tone = state === 'connected' ? 'sent' : state === 'qr' ? 'pending' : state === 'unreachable' ? 'failed' : 'draft'
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" aria-hidden />
      {t(`wa.state.${state}`)}
    </span>
  )
}
