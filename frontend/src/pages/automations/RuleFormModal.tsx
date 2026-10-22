import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, errorMessage } from '../../api/client'
import { useRuleContacts, useSaveRule } from '../../api/hooks'
import { ACTIONS, CONTACT_STATUSES, DELAY_UNITS, TRIGGERS, type FollowUpRule, type FollowUpRuleInput } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { isOutOfRule } from './matchContact'
import { RuleContactsField } from './RuleContactsField'
import { actionText, delayText, triggerText } from './ruleText'

const VARIABLES = ['first_name', 'full_name'] as const

interface RuleFormModalProps {
  open: boolean
  onClose: () => void
  rule?: FollowUpRule
}

export function RuleFormModal({ open, onClose, rule }: RuleFormModalProps) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={rule ? t('rule.editTitle') : t('rule.createTitle')} size="lg" custom>
      <RuleForm rule={rule} onClose={onClose} />
    </Modal>
  )
}

type Errors = Partial<Record<keyof FollowUpRuleInput, string>>

function RuleForm({ rule, onClose }: Omit<RuleFormModalProps, 'open'>) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveRule(rule?.id)
  const contacts = useRuleContacts(rule?.id)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState<FollowUpRuleInput>(() => ({
    name: rule?.name ?? '',
    trigger: rule?.trigger ?? 'status_is',
    trigger_status: rule?.trigger_status ?? 'no_answer',
    action: rule?.action ?? 'send_whatsapp',
    action_status: rule?.action_status ?? '',
    action_tag: rule?.action_tag ?? '',
    message_template: rule?.message_template ?? '',
    delay_amount: rule?.delay_amount ?? 2,
    delay_unit: rule?.delay_unit ?? 'days',
    is_active: rule?.is_active ?? true,
    excluded_contacts: rule?.excluded_contacts ?? [],
  }))
  const [errors, setErrors] = useState<Errors>({})
  const excludedSet = new Set(form.excluded_contacts)
  const outCount = contacts.data
    ? contacts.data.filter((contact) => isOutOfRule(contact, excludedSet)).length
    : form.excluded_contacts.length

  const set = <K extends keyof FollowUpRuleInput>(key: K, value: FollowUpRuleInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const insertVariable = (variable: string) => {
    const token = `{${variable}}`
    const el = messageRef.current
    const start = el?.selectionStart ?? form.message_template.length
    const end = el?.selectionEnd ?? form.message_template.length
    set('message_template', form.message_template.slice(0, start) + token + form.message_template.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const required = t('contactForm.required')
    const found: Errors = {}
    if (!form.name.trim()) found.name = required
    if (form.trigger === 'status_is' && !form.trigger_status) found.trigger_status = required
    if (form.action === 'change_status' && !form.action_status) found.action_status = required
    if (form.action === 'add_tag' && !form.action_tag.trim()) found.action_tag = required
    if (form.action === 'send_whatsapp' && !form.message_template.trim()) found.message_template = required
    if (!form.delay_amount || form.delay_amount < 1) found.delay_amount = required
    setErrors(found)
    if (Object.keys(found).length) return

    save.mutate(
      { ...form, name: form.name.trim(), action_tag: form.action_tag.trim() },
      {
        onSuccess: () => {
          toast.success(rule ? t('automations.updated') : t('automations.created'))
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 400) setErrors(error.fieldErrors())
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal__body">
        <div className="form-grid">
          <Field className="form-grid__full" label={t('rule.name')} error={errors.name}>
            {(props) => (
              <Input {...props} autoFocus placeholder={t('rule.namePlaceholder')} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={150} />
            )}
          </Field>

          <fieldset className="rule-step form-grid__full">
            <legend className="rule-step__legend">
              <span className="rule-flow__keyword">{t('automations.if')}</span>
              {t('rule.condition')}
            </legend>
            <div className="form-grid">
              <Field label={t('rule.condition')} className={form.trigger === 'status_is' ? undefined : 'form-grid__full'}>
                {(props) => (
                  <Select {...props} value={form.trigger} onChange={(e) => set('trigger', e.target.value as FollowUpRuleInput['trigger'])}>
                    {TRIGGERS.map((trigger) => (
                      <option key={trigger} value={trigger}>
                        {trigger === 'status_is' ? t('trigger.status_is_generic') : t(`trigger.${trigger}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {form.trigger === 'status_is' && (
                <Field label={t('rule.status')} error={errors.trigger_status}>
                  {(props) => (
                    <Select {...props} value={form.trigger_status} onChange={(e) => set('trigger_status', e.target.value as FollowUpRuleInput['trigger_status'])}>
                      {CONTACT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`status.${status}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </div>
          </fieldset>

          <fieldset className="rule-step form-grid__full">
            <legend className="rule-step__legend">
              <span className="rule-flow__keyword">{t('automations.then')}</span>
              {t('rule.actionLabel')}
            </legend>
            <div className="form-grid">
              <Field label={t('rule.actionLabel')} className={form.action === 'send_whatsapp' ? 'form-grid__full' : undefined}>
                {(props) => (
                  <Select {...props} value={form.action} onChange={(e) => set('action', e.target.value as FollowUpRuleInput['action'])}>
                    {ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {action === 'send_whatsapp' ? t('action.send_whatsapp') : t(`action.${action}_generic`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {form.action === 'change_status' && (
                <Field label={t('rule.newStatus')} error={errors.action_status}>
                  {(props) => (
                    <Select {...props} value={form.action_status} onChange={(e) => set('action_status', e.target.value as FollowUpRuleInput['action_status'])}>
                      <option value="" disabled>
                        —
                      </option>
                      {CONTACT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`status.${status}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {form.action === 'add_tag' && (
                <Field label={t('rule.tag')} error={errors.action_tag}>
                  {(props) => <Input {...props} value={form.action_tag} maxLength={40} onChange={(e) => set('action_tag', e.target.value)} />}
                </Field>
              )}
              {form.action === 'send_whatsapp' && (
                <Field className="form-grid__full" label={t('rule.message')} error={errors.message_template} hint={t('automations.consentNote')}>
                  {(props) => (
                    <>
                      <Textarea
                        {...props}
                        ref={messageRef}
                        rows={4}
                        dir="auto"
                        value={form.message_template}
                        onChange={(e) => set('message_template', e.target.value)}
                        maxLength={1000}
                      />
                      <div className="variable-chips">
                        <span className="subtle">{t('reminders.variables')}</span>
                        {VARIABLES.map((variable) => (
                          <button key={variable} type="button" className="filter-chip filter-chip--sm" onClick={() => insertVariable(variable)}>
                            {t(`reminders.var.${variable}`)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </Field>
              )}
            </div>
          </fieldset>

          <fieldset className="rule-step form-grid__full">
            <legend className="rule-step__legend">
              <span className="rule-flow__keyword">{t('automations.after')}</span>
              {t('rule.delay')}
            </legend>
            <div className="form-grid">
              <Field label={t('rule.delay')} error={errors.delay_amount}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10000}
                    value={form.delay_amount || ''}
                    onChange={(e) => set('delay_amount', Math.max(0, Math.floor(Number(e.target.value))))}
                  />
                )}
              </Field>
              <Field label={<span className="sr-only">{t('rule.delay')}</span>}>
                {(props) => (
                  <Select {...props} value={form.delay_unit} onChange={(e) => set('delay_unit', e.target.value as FollowUpRuleInput['delay_unit'])}>
                    {DELAY_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {t(`delay.unit.${unit}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </fieldset>

          <fieldset className="rule-step form-grid__full">
            <legend className="rule-step__legend">
              <span className="rule-flow__keyword">{t('rule.who')}</span>
              {t('rule.contactsTitle')}
            </legend>
            {contacts.data ? (
              <RuleContactsField
                contacts={contacts.data}
                excluded={form.excluded_contacts}
                onChange={(ids) => set('excluded_contacts', ids)}
                whatsapp={form.action === 'send_whatsapp'}
              />
            ) : contacts.isError ? (
              <p className="field__error">{errorMessage(contacts.error)}</p>
            ) : (
              <Spinner />
            )}
          </fieldset>

          <div className="rule-summary form-grid__full" aria-live="polite">
            <span className="rule-summary__label">{t('rule.summary')}</span>
            <ol className="rule-flow">
              <li className="rule-flow__step">
                <span className="rule-flow__keyword">{t('automations.if')}</span>
                <span className="rule-flow__value">{triggerText(form, t)}</span>
              </li>
              <li className="rule-flow__step">
                <span className="rule-flow__keyword">{t('automations.then')}</span>
                <span className="rule-flow__value">{actionText(form, t)}</span>
              </li>
              <li className="rule-flow__step">
                <span className="rule-flow__keyword">{t('automations.after')}</span>
                <span className="rule-flow__value">{form.delay_amount ? delayText(form, t) : '…'}</span>
              </li>
              <li className="rule-flow__step">
                <span className="rule-flow__keyword">{t('rule.who')}</span>
                <span className="rule-flow__value">{outCount ? t('rule.forAllBut', { count: outCount }) : t('rule.forAll')}</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
      <div className="modal__footer">
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
