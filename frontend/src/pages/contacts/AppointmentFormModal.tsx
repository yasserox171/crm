import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, errorMessage } from '../../api/client'
import { useSaveAppointment } from '../../api/hooks'
import { APPOINTMENT_STATUSES, type Appointment, type AppointmentStatus } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { addDays, combineDateTime, toDateInput, toTimeInput } from '../../lib/format'

const PRESETS = ['levelTest', 'visit', 'orientation', 'enrollment'] as const
const DURATIONS = [15, 30, 45, 60, 90]

interface AppointmentFormModalProps {
  open: boolean
  onClose: () => void
  contact: { id: number; full_name: string }
  appointment?: Appointment
}

export function AppointmentFormModal({ open, onClose, contact, appointment }: AppointmentFormModalProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={appointment ? t('appointment.editTitle') : t('appointment.createTitle')}
      description={t('appointment.for', { name: contact.full_name })}
      custom
    >
      <AppointmentForm contact={contact} appointment={appointment} onClose={onClose} />
    </Modal>
  )
}

function AppointmentForm({ contact, appointment, onClose }: Omit<AppointmentFormModalProps, 'open'>) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveAppointment(appointment?.id)
  const start = appointment ? new Date(appointment.scheduled_at) : defaultStart()
  const [date, setDate] = useState(toDateInput(start))
  const [time, setTime] = useState(toTimeInput(start))
  const [title, setTitle] = useState(appointment?.title ?? '')
  const [duration, setDuration] = useState(appointment?.duration_minutes ?? 30)
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? 'scheduled')
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!date || !time) return
    const scheduledAt = combineDateTime(date, time)
    if (status === 'scheduled' && new Date(scheduledAt) < new Date() && !appointment) {
      setError(t('appointment.pastError'))
      return
    }
    save.mutate(
      { contact: contact.id, scheduled_at: scheduledAt, title: title.trim(), duration_minutes: duration, notes, status },
      {
        onSuccess: () => {
          toast.success(appointment ? t('appointment.updated') : t('appointment.created'))
          onClose()
        },
        onError: (err) => {
          if (err instanceof ApiError && err.fieldErrors().scheduled_at) setError(t('appointment.pastError'))
          else toast.error(errorMessage(err))
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal__body">
        <div className="form-grid">
          <Field label={t('appointment.date')} error={error}>
            {(props) => (
              <Input
                {...props}
                type="date"
                required
                value={date}
                min={appointment ? undefined : toDateInput(new Date())}
                onChange={(e) => {
                  setDate(e.target.value)
                  setError(undefined)
                }}
              />
            )}
          </Field>
          <Field label={t('appointment.time')}>
            {(props) => (
              <Input
                {...props}
                type="time"
                required
                step={300}
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                  setError(undefined)
                }}
              />
            )}
          </Field>
          <Field className="form-grid__full" label={t('appointment.title')} optional>
            {(props) => (
              <>
                <Input {...props} placeholder={t('appointment.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
                <div className="preset-chips">
                  {PRESETS.map((preset) => {
                    const label = t(`appointment.presets.${preset}`)
                    return (
                      <button key={preset} type="button" className="filter-chip" aria-pressed={title === label} onClick={() => setTitle(label)}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </Field>
          <Field label={t('appointment.duration')}>
            {(props) => (
              <Select {...props} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t('appointment.minutes', { count: minutes })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {appointment && (
            <Field label={t('status.label')}>
              {(props) => (
                <Select {...props} value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                  {APPOINTMENT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`appointment.status.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field className="form-grid__full" label={t('appointment.notes')} optional>
            {(props) => <Textarea {...props} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
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

/** Tomorrow at 10:00 — the most common slot for a first visit. */
function defaultStart() {
  const date = addDays(new Date(), 1)
  date.setHours(10, 0, 0, 0)
  return date
}
