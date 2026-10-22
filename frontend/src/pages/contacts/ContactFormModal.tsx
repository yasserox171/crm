import { TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError, errorMessage } from '../../api/client'
import { useFindByPhone, useSaveContact } from '../../api/hooks'
import { CONTACT_SOURCES, CONTACT_STATUSES, SCHOOL_LEVELS, type Contact, type ContactInput } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, Select } from '../../components/ui/Form'
import { Modal } from '../../components/ui/Modal'
import { TagInput } from '../../components/ui/TagInput'
import { useToast } from '../../components/ui/Toast'
import { useDebounce } from '../../lib/useDebounce'
import { toDateInput } from '../../lib/format'
import { formatPhone, normalizePhone } from '../../lib/phone'

const SUBJECT_SUGGESTIONS = [
  'Mathématiques',
  'Physique-Chimie',
  'SVT',
  'Français',
  'Anglais',
  'Arabe',
  'Espagnol',
  'Allemand',
  'Philosophie',
  'Informatique',
  'Comptabilité',
]

interface ContactFormModalProps {
  open: boolean
  onClose: () => void
  contact?: Contact
  onSaved?: (contact: Contact) => void
  /** Pre-fill a new contact (e.g. from a WhatsApp chat). */
  initial?: { first_name?: string; phone?: string; source?: Contact['source'] }
}

export function ContactFormModal({ open, onClose, contact, onSaved, initial }: ContactFormModalProps) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={contact ? t('contactForm.editTitle') : t('contactForm.createTitle')} size="lg" custom>
      <ContactForm contact={contact} onClose={onClose} onSaved={onSaved} initial={initial} />
    </Modal>
  )
}

type FormState = ContactInput
type Errors = Partial<Record<keyof FormState | 'form', string>>

function initialState(contact?: Contact, initial?: ContactFormModalProps['initial']): FormState {
  return {
    first_name: contact?.first_name ?? initial?.first_name ?? '',
    last_name: contact?.last_name ?? '',
    phone: contact ? formatPhone(contact.phone) : initial?.phone ? formatPhone(initial.phone) : '',
    city: contact?.city ?? 'Safi',
    subject: contact?.subject ?? '',
    level: contact?.level ?? '',
    status: contact?.status ?? 'new',
    source: contact?.source ?? initial?.source ?? 'ad',
    consent: contact?.consent ?? false,
    tags: contact?.tags ?? [],
    registered_at: contact?.registered_at ?? toDateInput(new Date()),
  }
}

function ContactForm({ contact, onClose, onSaved, initial }: Omit<ContactFormModalProps, 'open'>) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveContact(contact?.id)
  const [form, setForm] = useState<FormState>(() => initialState(contact, initial))
  const [errors, setErrors] = useState<Errors>({})
  const [phoneTouched, setPhoneTouched] = useState(false)

  const normalized = normalizePhone(form.phone)
  const debouncedPhone = useDebounce(normalized, 400)
  const duplicate = useFindByPhone(debouncedPhone, contact?.id).data

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const validate = (): Errors => {
    const next: Errors = {}
    if (!form.first_name.trim()) next.first_name = t('contactForm.required')
    if (!form.phone.trim()) next.phone = t('contactForm.required')
    else if (!normalized) next.phone = t('contactForm.phoneInvalid')
    return next
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    save.mutate(
      { ...form, first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: normalized ?? form.phone },
      {
        onSuccess: (saved) => {
          toast.success(contact ? t('contactForm.updated') : t('contactForm.created'))
          onClose()
          onSaved?.(saved)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 400) setErrors(error.fieldErrors())
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  const phoneError = errors.phone ?? (phoneTouched && form.phone && !normalized ? t('contactForm.phoneInvalid') : undefined)

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal__body">
        <div className="form-grid">
          <Field label={t('contactForm.firstName')} error={errors.first_name}>
            {(props) => (
              <Input {...props} autoComplete="off" autoFocus value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            )}
          </Field>
          <Field label={t('contactForm.lastName')} optional error={errors.last_name}>
            {(props) => <Input {...props} autoComplete="off" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />}
          </Field>

          <Field
            className="form-grid__full"
            label={t('contactForm.phone')}
            error={phoneError}
            hint={
              normalized && formatPhone(normalized) !== form.phone.trim()
                ? t('contactForm.phoneWillSave', { phone: formatPhone(normalized) })
                : t('contactForm.phoneHint')
            }
          >
            {(props) => (
              <div className="input-group phone-input" dir="ltr">
                <span className="input-group__prefix">+212</span>
                <Input
                  {...props}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="6 12 34 56 78"
                  value={form.phone.replace(/^\+212\s?/, '')}
                  onChange={(e) => set('phone', e.target.value)}
                  onBlur={() => {
                    setPhoneTouched(true)
                    if (normalized) set('phone', formatPhone(normalized))
                  }}
                />
              </div>
            )}
          </Field>
          {duplicate && (
            <div className="banner banner--warning form-grid__full" role="status">
              <TriangleAlert aria-hidden />
              <span className="banner__text">{t('contactForm.duplicate', { name: duplicate.full_name })}</span>
              <Link to={`/contacts/${duplicate.id}`} onClick={onClose} className="text-btn">
                {t('contactForm.openDuplicate')}
              </Link>
            </div>
          )}

          <Field label={t('contactForm.subject')} optional>
            {(props) => (
              <>
                <Input
                  {...props}
                  list="subject-suggestions"
                  placeholder={t('contactForm.subjectPlaceholder')}
                  value={form.subject}
                  onChange={(e) => set('subject', e.target.value)}
                />
                <datalist id="subject-suggestions">
                  {SUBJECT_SUGGESTIONS.map((subject) => (
                    <option key={subject} value={subject} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label={t('level.label')} optional>
            {(props) => (
              <Select {...props} value={form.level} onChange={(e) => set('level', e.target.value as FormState['level'])}>
                <option value="">{t('level.none')}</option>
                {SCHOOL_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`level.${level}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t('contactForm.city')} optional>
            {(props) => <Input {...props} value={form.city} onChange={(e) => set('city', e.target.value)} />}
          </Field>
          <Field label={t('contactForm.registeredAt')} error={errors.registered_at}>
            {(props) => (
              <Input {...props} type="date" value={form.registered_at} onChange={(e) => set('registered_at', e.target.value)} />
            )}
          </Field>

          <Field label={t('status.label')}>
            {(props) => (
              <Select {...props} value={form.status} onChange={(e) => set('status', e.target.value as FormState['status'])}>
                {CONTACT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('source.label')}>
            {(props) => (
              <Select {...props} value={form.source} onChange={(e) => set('source', e.target.value as FormState['source'])}>
                {CONTACT_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {t(`source.${source}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field className="form-grid__full" label={t('contactForm.tags')} optional>
            {(props) => (
              <TagInput id={props.id} value={form.tags} onChange={(tags) => set('tags', tags)} placeholder={t('contactForm.tagsPlaceholder')} />
            )}
          </Field>

          <div className="form-grid__full consent-box">
            <label className="check-label">
              <Checkbox checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
              <span>
                <span className="consent-box__label">{t('contactForm.consent')}</span>
                <span className="field__hint consent-box__hint">{t('contactForm.consentHint')}</span>
              </span>
            </label>
          </div>
        </div>
      </div>
      <div className="modal__footer">
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {contact ? t('common.save') : t('contactForm.submitCreate')}
        </Button>
      </div>
    </form>
  )
}
