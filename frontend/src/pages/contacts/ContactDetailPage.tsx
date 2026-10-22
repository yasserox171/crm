import { ArrowLeft, CalendarPlus, Check, CircleAlert, ExternalLink, MessageCircle, Pencil, Phone, Plus, Trash2, UserX, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, errorMessage } from '../../api/client'
import { useAppointments, useContact, useDeleteAppointment, useDeleteContact, useSaveAppointment, useSaveContact } from '../../api/hooks'
import { CONTACT_STATUSES, type Appointment, type Contact, type ContactStatus } from '../../api/types'
import { SendMessageModal } from '../../components/messaging/SendMessageModal'
import { Avatar } from '../../components/ui/Avatar'
import { SourceTag } from '../../components/ui/Badges'
import { Button } from '../../components/ui/Button'
import { buttonClass } from '../../components/ui/buttonClass'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { PageLoader } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatDate, formatDateTime, formatTime, parseLocalDate } from '../../lib/format'
import { whatsappLink } from '../../lib/phone'
import { useExclusionToggle } from '../automations/useExclusionToggle'
import { AppointmentFormModal } from './AppointmentFormModal'
import { ContactFormModal } from './ContactFormModal'
import { NoteComposer, Timeline } from './Timeline'

export default function ContactDetailPage() {
  const { t } = useTranslation()
  const id = Number(useParams().id)
  const { data: contact, isPending, error } = useContact(id)

  if (isPending) return <PageLoader />
  if (!contact) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <div className="page">
        <BackLink />
        <EmptyState
          icon={notFound ? <UserX /> : <CircleAlert />}
          title={notFound ? t('contact.notFound') : errorMessage(error)}
          action={
            <Link to="/contacts" className={buttonClass({ variant: 'primary' })}>
              {t('notFound.home')}
            </Link>
          }
        />
      </div>
    )
  }
  return <ContactDetail contact={contact} />
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/contacts" className="back-link">
      <ArrowLeft className="flip-rtl" aria-hidden />
      {t('contact.back')}
    </Link>
  )
}

function ContactDetail({ contact }: { contact: Contact }) {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const save = useSaveContact(contact.id)
  const remove = useDeleteContact()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [appointmentOpen, setAppointmentOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const exclusion = useExclusionToggle()

  const changeStatus = (status: ContactStatus) =>
    save.mutate(
      { status },
      {
        onSuccess: () => toast.success(t('contact.statusUpdated', { status: t(`status.${status}`) })),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )

  const updateTags = (tags: string[], message?: string) =>
    save.mutate(
      { tags },
      {
        onSuccess: () => message && toast.success(message),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )

  const deleteContact = () =>
    remove.mutate(contact.id, {
      onSuccess: () => {
        toast.success(t('contactForm.deleted'))
        navigate('/contacts', { replace: true })
      },
      onError: (error) => toast.error(errorMessage(error)),
    })

  return (
    <div className="page">
      <BackLink />

      <section className="card profile">
        <div className="profile__main">
          <Avatar name={contact.full_name} size="lg" />
          <div className="profile__identity">
            <h1 className="profile__name">{contact.full_name}</h1>
            <div className="profile__line">
              <PhoneNumber value={contact.phone} />
              {contact.city && <span className="subtle">· {contact.city}</span>}
            </div>
            <div className="profile__badges">
              <label className="status-select-wrap">
                <span className="sr-only">{t('contact.changeStatus')}</span>
                <select
                  className={`status-select badge--${contact.status}`}
                  value={contact.status}
                  onChange={(event) => changeStatus(event.target.value as ContactStatus)}
                  disabled={save.isPending}
                >
                  {CONTACT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
              </label>
              <SourceTag source={contact.source} />
            </div>
          </div>
          <div className="profile__actions">
            <Button variant="primary" icon={<MessageCircle aria-hidden />} onClick={() => setComposeOpen(true)}>
              {t('contact.sendMessage')}
            </Button>
            <a
              className={buttonClass({ variant: 'secondary', iconOnly: true })}
              href={whatsappLink(contact.phone)}
              target="_blank"
              rel="noreferrer"
              aria-label={t('contact.openWhatsapp')}
              title={t('contact.openWhatsapp')}
            >
              <ExternalLink aria-hidden />
            </a>
            <a className={buttonClass({ variant: 'secondary' })} href={`tel:${contact.phone}`}>
              <Phone aria-hidden />
              <span className="hide-mobile">{t('contact.call')}</span>
            </a>
            <Button iconOnly label={t('common.edit')} icon={<Pencil aria-hidden />} onClick={() => setEditOpen(true)} />
            <Button variant="ghost" iconOnly label={t('common.delete')} icon={<Trash2 aria-hidden />} onClick={() => setDeleteOpen(true)} />
          </div>
        </div>

        <TagEditor tags={contact.tags} onChange={updateTags} />

        <dl className="profile__facts">
          <div>
            <dt>{t('contactForm.subject')}</dt>
            <dd>{contact.subject || t('common.none')}</dd>
          </div>
          <div>
            <dt>{t('level.label')}</dt>
            <dd>{contact.level ? t(`level.${contact.level}`) : t('common.none')}</dd>
          </div>
          <div>
            <dt>{t('contactForm.registeredAt')}</dt>
            <dd className="tabular">{formatDate(parseLocalDate(contact.registered_at), { dateStyle: 'long' })}</dd>
          </div>
          <div>
            <dt>{t('contacts.columns.consent')}</dt>
            <dd className={contact.consent ? 'consent-yes' : 'consent-no'}>
              {contact.consent && contact.consent_at
                ? t('contact.consentSince', { date: formatDate(contact.consent_at) })
                : contact.consent
                  ? t('common.yes')
                  : t('contacts.consentNo')}
            </dd>
          </div>
          <div>
            <dt>{t('audience.label')}</dt>
            <dd className="automation-state">
              <span className={contact.automations_excluded ? 'consent-no' : 'consent-yes'}>
                {contact.automations_excluded
                  ? contact.automations_excluded_at
                    ? t('audience.excludedSince', { date: formatDate(contact.automations_excluded_at) })
                    : t('audience.excluded')
                  : t('audience.included')}
              </span>
              <button
                type="button"
                className="text-btn"
                disabled={exclusion.busyId === contact.id}
                onClick={() => exclusion.toggle(contact, !contact.automations_excluded)}
              >
                {contact.automations_excluded ? t('audience.restore') : t('audience.exclude')}
              </button>
            </dd>
          </div>
        </dl>
      </section>

      <div className="detail-grid">
        <section className="card detail-grid__appointments">
          <div className="card__header">
            <h2 className="card__title">{t('contact.appointments')}</h2>
            <Button size="sm" icon={<CalendarPlus aria-hidden />} onClick={() => setAppointmentOpen(true)}>
              {t('contact.schedule')}
            </Button>
          </div>
          <AppointmentList contact={contact} />
        </section>

        <section className="card detail-grid__timeline">
          <div className="card__header">
            <h2 className="card__title">{t('timeline.title')}</h2>
          </div>
          <div className="card__body stack">
            <NoteComposer contactId={contact.id} />
            <Timeline contactId={contact.id} />
          </div>
        </section>
      </div>

      <ContactFormModal open={editOpen} onClose={() => setEditOpen(false)} contact={contact} />
      <AppointmentFormModal open={appointmentOpen} onClose={() => setAppointmentOpen(false)} contact={contact} />
      <SendMessageModal open={composeOpen} onClose={() => setComposeOpen(false)} selection={{ contact_ids: [contact.id] }} />
      <ConfirmDialog
        open={deleteOpen}
        title={t('common.confirmDeleteTitle')}
        description={t('contactForm.deleteConfirm', { name: contact.full_name })}
        confirmLabel={t('common.delete')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={deleteContact}
        onCancel={() => setDeleteOpen(false)}
      >
        <p className="muted">{t('common.irreversible')}</p>
      </ConfirmDialog>
    </div>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[], message?: string) => void }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const tag = draft.trim().slice(0, 40)
    if (tag && !tags.includes(tag)) onChange([...tags, tag], t('contact.tagAdded'))
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="profile__tags">
      {tags.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button
            type="button"
            className="chip__remove"
            onClick={() => onChange(tags.filter((item) => item !== tag))}
            aria-label={`${t('common.delete')} ${tag}`}
          >
            <X aria-hidden />
          </button>
        </span>
      ))}
      {adding ? (
        <form className="tag-add" onSubmit={submit}>
          <input
            className="input input--sm"
            autoFocus
            value={draft}
            maxLength={40}
            aria-label={t('contact.addTag')}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submit}
            onKeyDown={(event) => event.key === 'Escape' && setAdding(false)}
          />
        </form>
      ) : (
        <button type="button" className="tag-add-btn" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t('contact.addTag')}
        </button>
      )}
    </div>
  )
}

const APPOINTMENT_BADGE: Record<Appointment['status'], string> = {
  scheduled: 'scheduled',
  attended: 'sent',
  no_show: 'failed',
  cancelled: 'draft',
}

function AppointmentList({ contact }: { contact: Contact }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { data: appointments = [], isPending } = useAppointments({ contact: contact.id })
  const [editing, setEditing] = useState<Appointment>()
  const [deleting, setDeleting] = useState<Appointment>()
  const remove = useDeleteAppointment()
  // Reference time for the upcoming/past split, fixed for the component's lifetime.
  const [now] = useState(Date.now)
  const upcoming = appointments.filter((a) => a.status === 'scheduled' && new Date(a.scheduled_at).getTime() >= now)
  const past = appointments.filter((a) => !upcoming.includes(a)).reverse()

  if (isPending) return <div className="card__body skeleton" style={{ blockSize: 64, margin: 16 }} />

  return (
    <div className="card__body appointment-list">
      {upcoming.length === 0 && <p className="muted">{t('contact.noAppointments')}</p>}
      {upcoming.map((appointment) => (
        <AppointmentRow key={appointment.id} appointment={appointment} onEdit={() => setEditing(appointment)} onDelete={() => setDeleting(appointment)} />
      ))}
      {past.length > 0 && (
        <>
          <h3 className="appointment-list__heading">{t('contact.pastAppointments')}</h3>
          {past.map((appointment) => (
            <AppointmentRow key={appointment.id} appointment={appointment} onEdit={() => setEditing(appointment)} onDelete={() => setDeleting(appointment)} />
          ))}
        </>
      )}
      <AppointmentFormModal open={!!editing} onClose={() => setEditing(undefined)} contact={contact} appointment={editing} />
      <ConfirmDialog
        open={!!deleting}
        title={t('common.confirmDeleteTitle')}
        description={deleting && t('appointment.deleteConfirm', { date: formatDateTime(deleting.scheduled_at) })}
        confirmLabel={t('common.delete')}
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('appointment.deleted'))
              setDeleting(undefined)
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

function AppointmentRow({ appointment, onEdit, onDelete }: { appointment: Appointment; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveAppointment(appointment.id)
  const date = new Date(appointment.scheduled_at)
  const isScheduled = appointment.status === 'scheduled'

  const setStatus = (status: Appointment['status']) =>
    save.mutate(
      { status },
      {
        onSuccess: () => toast.success(t('appointment.updated')),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )

  return (
    <div className={`appointment-row${isScheduled ? '' : ' appointment-row--past'}`}>
      <div className="date-tile" aria-hidden>
        <span className="date-tile__month">{formatDate(date, { month: 'short' })}</span>
        <span className="date-tile__day">{formatDate(date, { day: 'numeric' })}</span>
      </div>
      <div className="appointment-row__info">
        <span className="appointment-row__title">{appointment.title || t('appointment.title')}</span>
        <span className="muted tabular">
          {formatDate(date, { weekday: 'long' })} · {formatTime(date)}
        </span>
        <span className={`badge badge--${APPOINTMENT_BADGE[appointment.status]}`}>
          <span className="badge__dot" aria-hidden />
          {t(`appointment.status.${appointment.status}`)}
        </span>
      </div>
      <div className="appointment-row__actions">
        {isScheduled && (
          <>
            <Button size="sm" variant="ghost" iconOnly label={t('appointment.markAttended')} icon={<Check aria-hidden />} onClick={() => setStatus('attended')} disabled={save.isPending} />
            <Button size="sm" variant="ghost" iconOnly label={t('appointment.markNoShow')} icon={<UserX aria-hidden />} onClick={() => setStatus('no_show')} disabled={save.isPending} />
          </>
        )}
        <Button size="sm" variant="ghost" iconOnly label={t('common.edit')} icon={<Pencil aria-hidden />} onClick={onEdit} />
        <Button size="sm" variant="ghost" iconOnly label={t('common.delete')} icon={<Trash2 aria-hidden />} onClick={onDelete} />
      </div>
    </div>
  )
}
