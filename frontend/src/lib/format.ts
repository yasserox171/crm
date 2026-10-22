import i18n, { currentLanguage } from '../i18n'

const LOCALES = { fr: 'fr-MA', ar: 'ar-MA', en: 'en-GB' } as const

export function locale(): string {
  return LOCALES[currentLanguage()]
}

type DateInput = string | number | Date

const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value))

export function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(locale(), options).format(toDate(value))
}

export function formatTime(value: DateInput) {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(toDate(value))
}

export function formatDateTime(value: DateInput) {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(toDate(value))
}

/** "Today", "Tomorrow", "Yesterday" or a long date. */
export function formatDayLabel(value: DateInput, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const date = toDate(value)
  const diff = daysBetween(new Date(), date)
  if (diff === 0) return i18n.t('common.today')
  if (diff === 1) return i18n.t('common.tomorrow')
  if (diff === -1) return i18n.t('common.yesterday')
  return formatDate(date, options)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "il y a 2 heures", "dans 3 jours"… */
export function formatRelative(value: DateInput) {
  const seconds = (toDate(value).getTime() - Date.now()) / 1000
  if (Math.abs(seconds) < 60) return i18n.t('common.justNow')
  const formatter = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return i18n.t('common.justNow')
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

/** Local calendar day as YYYY-MM-DD (for <input type="date"> and grouping). */
export function toDateInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function toTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Combines local date + time inputs into an ISO string (with the browser's offset). */
export function combineDateTime(date: string, time: string) {
  return new Date(`${date}T${time || '00:00'}`).toISOString()
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(locale()).format(value)
}

/** Parses a YYYY-MM-DD date as a local calendar day (avoids UTC off-by-one). */
export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
