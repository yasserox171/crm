import { CircleAlert, Info, Pause, Pencil, Play, Plus, Trash2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../api/client'
import { useDeleteRule, useRules, useSettings, useToggleRule, useUpdateSettings } from '../../api/hooks'
import type { FollowUpRule } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Switch } from '../../components/ui/Form'
import { PageLoader } from '../../components/ui/Spinner'
import { MessagingModeBanner } from '../../components/messaging/MessagingModeBanner'
import { useToast } from '../../components/ui/Toast'
import { formatDateTime, formatRelative } from '../../lib/format'
import { AudiencePanel } from './AudiencePanel'
import { RuleFormModal } from './RuleFormModal'
import { actionText, delayText, triggerText } from './ruleText'

export default function AutomationsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const rules = useRules()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FollowUpRule>()
  const [deleting, setDeleting] = useState<FollowUpRule>()
  const remove = useDeleteRule()

  const paused = settings.data?.automations_paused ?? false

  const togglePause = () =>
    updateSettings.mutate(
      { automations_paused: !paused },
      {
        onSuccess: (data) => toast.success(data.automations_paused ? t('automations.paused') : t('automations.resumed')),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )

  const openCreate = () => {
    setEditing(undefined)
    setFormOpen(true)
  }

  if (rules.isPending) return <PageLoader />

  return (
    <div className="page">
      <header className="page__header page__header--hide-title-mobile">
        <div className="page__heading">
          <h1 className="page__title">{t('automations.title')}</h1>
          <p className="page__subtitle">{t('automations.subtitle')}</p>
        </div>
        <div className="page__actions">
          <Button
            variant={paused ? 'primary' : 'secondary'}
            icon={paused ? <Play className="flip-rtl" aria-hidden /> : <Pause aria-hidden />}
            onClick={togglePause}
            loading={updateSettings.isPending}
            disabled={!settings.data}
          >
            {paused ? t('automations.resumeAll') : t('automations.pauseAll')}
          </Button>
          <Button variant={paused ? 'secondary' : 'primary'} icon={<Plus aria-hidden />} onClick={openCreate}>
            {t('automations.new')}
          </Button>
        </div>
      </header>

      <MessagingModeBanner />

      {paused && (
        <div className="banner banner--warning page-banner" role="status">
          <Pause aria-hidden />
          <span className="banner__text">
            {t('automations.pausedBanner', { time: settings.data?.paused_at ? formatDateTime(settings.data.paused_at) : '' })}
          </span>
          <Button size="sm" onClick={togglePause} loading={updateSettings.isPending}>
            {t('automations.resumeAll')}
          </Button>
        </div>
      )}

      {rules.isError ? (
        <div className="banner banner--danger" role="alert">
          <CircleAlert aria-hidden />
          <span className="banner__text">{errorMessage(rules.error)}</span>
        </div>
      ) : rules.data.length === 0 ? (
        <section className="card">
          <EmptyState
            icon={<Workflow />}
            title={t('automations.emptyTitle')}
            text={t('automations.emptyText')}
            action={
              <Button variant="primary" icon={<Plus aria-hidden />} onClick={openCreate}>
                {t('automations.new')}
              </Button>
            }
          />
        </section>
      ) : (
        <div className="rule-grid">
          {rules.data.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              paused={paused}
              onEdit={() => {
                setEditing(rule)
                setFormOpen(true)
              }}
              onDelete={() => setDeleting(rule)}
            />
          ))}
        </div>
      )}

      {!!rules.data?.length && <AudiencePanel />}

      <p className="automation-note subtle">
        <Info aria-hidden />
        <span>
          {t('automations.onlyNewEvents')} {t('automations.consentNote')}
        </span>
      </p>

      <RuleFormModal open={formOpen} onClose={() => setFormOpen(false)} rule={editing} />
      <ConfirmDialog
        open={!!deleting}
        title={t('common.confirmDeleteTitle')}
        description={deleting && t('automations.deleteConfirm', { name: deleting.name })}
        confirmLabel={t('common.delete')}
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('automations.deleted'))
              setDeleting(undefined)
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

function RuleCard({ rule, paused, onEdit, onDelete }: { rule: FollowUpRule; paused: boolean; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const toggle = useToggleRule()

  const onToggle = (is_active: boolean) =>
    toggle.mutate(
      { id: rule.id, is_active },
      {
        onSuccess: () => toast.success(is_active ? t('automations.enabled') : t('automations.disabled')),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )

  const state = !rule.is_active ? 'off' : paused ? 'paused' : 'on'

  return (
    <article className={`card rule-card rule-card--${state}`}>
      <header className="rule-card__header">
        <div className="rule-card__heading">
          <h2 className="rule-card__name">{rule.name}</h2>
          {rule.is_active && paused && <span className="badge badge--warning">{t('automations.pausedChip')}</span>}
        </div>
        <Switch checked={rule.is_active} onChange={onToggle} label={t('automations.toggle', { name: rule.name })} />
      </header>

      <ol className="rule-flow">
        <li className="rule-flow__step">
          <span className="rule-flow__keyword">{t('automations.if')}</span>
          <span className="rule-flow__value">{triggerText(rule, t)}</span>
        </li>
        <li className="rule-flow__step">
          <span className="rule-flow__keyword">{t('automations.then')}</span>
          <span className="rule-flow__value">{actionText(rule, t)}</span>
        </li>
        <li className="rule-flow__step">
          <span className="rule-flow__keyword">{t('automations.after')}</span>
          <span className="rule-flow__value">{delayText(rule, t)}</span>
        </li>
      </ol>

      {rule.action === 'send_whatsapp' && rule.message_template && (
        <p className="rule-card__message" dir="auto">
          {rule.message_template}
        </p>
      )}

      <footer className="rule-card__footer">
        <span className="subtle rule-card__stats">
          {t('automations.runs', { count: rule.run_count })}
          {rule.last_run_at && <span title={formatDateTime(rule.last_run_at)}> · {t('automations.lastRun', { time: formatRelative(rule.last_run_at) })}</span>}
          {rule.executions_skipped > 0 && <span> · {t('automations.skipped', { count: rule.executions_skipped })}</span>}
          {rule.excluded_contacts.length > 0 && <span> · {t('automations.excludedCount', { count: rule.excluded_contacts.length })}</span>}
        </span>
        <div className="icon-btn-row">
          <Button size="sm" variant="ghost" iconOnly label={t('common.edit')} icon={<Pencil aria-hidden />} onClick={onEdit} />
          <Button size="sm" variant="ghost" iconOnly label={t('common.delete')} icon={<Trash2 aria-hidden />} onClick={onDelete} />
        </div>
      </footer>
    </article>
  )
}
