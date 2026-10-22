import { Send, ShieldOff, TriangleAlert, UsersRound } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, errorMessage } from '../../api/client'
import { useBulkPreview, useBulkSend, useWhatsAppStatus } from '../../api/hooks'
import type { BulkPreview, ContactSelection } from '../../api/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Textarea } from '../ui/Form'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { BatchStatusPanel } from './BatchStatus'
import { useManualMode } from './useManualMode'
import { useWebMode } from './useWebMode'
import { MessagingModeBanner } from './MessagingModeBanner'

const VARIABLES = ['first_name', 'full_name'] as const

/** Mirrors the server's render_template for messages without an appointment. */
function renderForContact(body: string, sample: NonNullable<BulkPreview['sample']>) {
  const values: Record<string, string> = { ...sample, date: '', time: '', title: '' }
  return body.replace(/\{(first_name|last_name|full_name|date|time|title)\}/g, (_, key: string) => values[key]).trim()
}

interface SendMessageModalProps {
  open: boolean
  onClose: () => void
  selection: ContactSelection
  /** Called once the messages are queued (e.g. to clear the list selection). */
  onSent?: () => void
}

/** Compose → (confirm) → live delivery status, for one or many contacts. */
export function SendMessageModal({ open, onClose, selection, onSent }: SendMessageModalProps) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={t('compose.title')} custom>
      <SendMessageForm selection={selection} onClose={onClose} onSent={onSent} />
    </Modal>
  )
}

function SendMessageForm({ selection, onClose, onSent }: Omit<SendMessageModalProps, 'open'>) {
  const { t } = useTranslation()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState<string>()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preview = useBulkPreview(selection, !batchId)
  const send = useBulkSend()
  const manual = useManualMode()
  const web = useWebMode()
  const waStatus = useWhatsAppStatus(web).data

  const eligible = preview.data?.eligible ?? 0
  const noConsent = preview.data?.no_consent ?? 0
  const max = preview.data?.max_recipients ?? Infinity
  const tooMany = eligible > max
  const canSend = !!body.trim() && eligible > 0 && !tooMany && !preview.isPending
  // Linked account: messages already queued use today's quota first.
  const remainingToday =
    web && waStatus?.daily_limit !== undefined
      ? Math.max(0, waStatus.daily_limit - (waStatus.sent_today ?? 0) - (waStatus.pending ?? 0))
      : Infinity
  const overQuota = eligible > remainingToday

  const insertVariable = (variable: string) => {
    const token = `{${variable}}`
    const el = textareaRef.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    setBody(body.slice(0, start) + token + body.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const doSend = () =>
    send.mutate(
      { ...selection, body },
      {
        onSuccess: (result) => {
          setConfirmOpen(false)
          toast.success(manual ? t('compose.ready', { count: result.queued }) : t('compose.queued', { count: result.queued }))
          setBatchId(result.batch_id)
          onSent?.()
        },
        onError: (error) => {
          setConfirmOpen(false)
          if (error instanceof ApiError && error.code === 'too_many_recipients') toast.error(t('compose.tooMany', { max }))
          else if (error instanceof ApiError && error.fieldErrors().body) setBodyError(t('reminders.templateEmpty'))
          else toast.error(errorMessage(error))
        },
      },
    )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!body.trim()) {
      setBodyError(t('reminders.templateEmpty'))
      return
    }
    if (!canSend) return
    // A confirmation is required before messaging several people at once — except in manual
    // mode, where nothing leaves until each message is sent by hand from WhatsApp.
    if (eligible > 1 && !manual) setConfirmOpen(true)
    else doSend()
  }

  if (batchId) {
    return (
      <>
        <div className="modal__body">
          <BatchStatusPanel batchId={batchId} embedded />
        </div>
        <div className="modal__footer">
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </>
    )
  }

  const sample = preview.data?.sample
  const rendered = sample ? renderForContact(body, sample) : ''

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal__body stack">
        <MessagingModeBanner />
        <div className="recipient-summary" aria-live="polite">
          <UsersRound aria-hidden />
          <strong>{preview.data ? t('compose.recipients', { count: eligible }) : t('common.loading')}</strong>
          {noConsent > 0 && (
            <span className="badge badge--warning">
              <ShieldOff aria-hidden />
              {t('compose.noConsent', { count: noConsent })}
            </span>
          )}
        </div>
        {preview.data && eligible === 0 && (
          <div className="banner banner--warning" role="status">
            <TriangleAlert aria-hidden />
            <span className="banner__text">{t('compose.noEligible')}</span>
          </div>
        )}
        {overQuota && !tooMany && (
          <div className="banner banner--warning" role="status">
            <TriangleAlert aria-hidden />
            <span className="banner__text">{t('compose.overQuota', { count: remainingToday })}</span>
          </div>
        )}
        {tooMany && (
          <div className="banner banner--danger" role="alert">
            <TriangleAlert aria-hidden />
            <span className="banner__text">{t('compose.tooMany', { max })}</span>
          </div>
        )}

        <Field label={t('reminders.message')} error={bodyError}>
          {(props) => (
            <Textarea
              {...props}
              ref={textareaRef}
              dir="auto"
              rows={5}
              autoFocus
              maxLength={1000}
              placeholder={t('compose.placeholder')}
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                setBodyError(undefined)
              }}
            />
          )}
        </Field>
        <div className="variable-chips">
          <span className="subtle">{t('reminders.variables')}</span>
          {VARIABLES.map((variable) => (
            <button key={variable} type="button" className="filter-chip filter-chip--sm" onClick={() => insertVariable(variable)}>
              {t(`reminders.var.${variable}`)}
            </button>
          ))}
        </div>

        <div className="preview">
          <div className="preview__header">
            <span className="preview__title">
              {sample ? t('reminders.previewFor', { name: sample.full_name }) : t('reminders.preview')}
            </span>
          </div>
          <div className="preview__screen">
            {rendered ? (
              <p className="bubble bubble--out" dir="auto">
                {rendered}
              </p>
            ) : (
              <p className="subtle preview__empty">{t('compose.previewEmpty')}</p>
            )}
          </div>
        </div>
      </div>
      <div className="modal__footer">
        <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" icon={<Send className="flip-rtl" aria-hidden />} loading={send.isPending} disabled={!canSend}>
          {manual ? t('compose.prepare', { count: eligible }) : t('compose.send', { count: eligible })}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('compose.confirmTitle', { count: eligible })}
        description={t('reminders.confirmText')}
        confirmLabel={t('reminders.confirm', { count: eligible })}
        loading={send.isPending}
        onConfirm={doSend}
        onCancel={() => setConfirmOpen(false)}
      >
        {rendered && (
          <div className="preview__screen preview__screen--confirm">
            <p className="bubble bubble--out" dir="auto">
              {rendered}
            </p>
          </div>
        )}
      </ConfirmDialog>
    </form>
  )
}
