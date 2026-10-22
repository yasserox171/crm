import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMonthPosts } from '../../api/hooks'
import type { ContentPost } from '../../api/types'
import { PostStatusBadge } from '../../components/ui/Badges'
import { Button } from '../../components/ui/Button'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { addDays, formatDate, formatDayLabel, formatTime, toDateInput } from '../../lib/format'

const MAX_CHIPS = 3

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Monday-first weeks covering the whole month. */
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = addDays(first, -offset)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const weeks = Math.ceil((offset + last.getDate()) / 7)
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index))
}

interface MonthCalendarProps {
  onOpenPost: (post: ContentPost) => void
  onCreate: (date: Date) => void
}

export function MonthCalendar({ onOpenPost, onCreate }: MonthCalendarProps) {
  const { t } = useTranslation()
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(() => toDateInput(today))
  const { data: posts = [], isFetching } = useMonthPosts(monthKey(month))

  const byDay = new Map<string, ContentPost[]>()
  for (const post of posts) {
    if (!post.scheduled_at) continue
    const key = toDateInput(new Date(post.scheduled_at))
    byDay.set(key, [...(byDay.get(key) ?? []), post])
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))

  const days = monthGrid(month)
  const weekdays = days.slice(0, 7).map((day) => ({
    short: formatDate(day, { weekday: 'short' }),
    long: formatDate(day, { weekday: 'long' }),
  }))
  const todayKey = toDateInput(today)
  const selectedPosts = byDay.get(selectedDay) ?? []
  const selectedDate = new Date(`${selectedDay}T00:00`)

  const goToMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    setMonth(next)
    setSelectedDay(toDateInput(next.getMonth() === today.getMonth() && next.getFullYear() === today.getFullYear() ? today : next))
  }

  return (
    <div className="calendar" aria-busy={isFetching}>
      <div className="calendar__toolbar">
        <div className="row">
          <Button size="sm" variant="ghost" iconOnly label={t('content.previousMonth')} icon={<ChevronLeft className="flip-rtl" aria-hidden />} onClick={() => goToMonth(-1)} />
          <Button size="sm" variant="ghost" iconOnly label={t('content.nextMonth')} icon={<ChevronRight className="flip-rtl" aria-hidden />} onClick={() => goToMonth(1)} />
          <h2 className="calendar__month" aria-live="polite">
            {formatDate(month, { month: 'long', year: 'numeric' })}
          </h2>
        </div>
        <div className="row">
          <div className="calendar__legend hide-mobile">
            <PostStatusBadge status="draft" />
            <PostStatusBadge status="scheduled" />
            <PostStatusBadge status="published" />
          </div>
          <Button size="sm" onClick={() => goToMonth((today.getFullYear() - month.getFullYear()) * 12 + today.getMonth() - month.getMonth())}>
            {t('common.today')}
          </Button>
        </div>
      </div>

      <div className="calendar__grid" role="grid" aria-label={formatDate(month, { month: 'long', year: 'numeric' })}>
        <div className="calendar__row calendar__weekdays" role="row">
          {weekdays.map((weekday) => (
            <div key={weekday.long} className="calendar__weekday" role="columnheader" title={weekday.long}>
              {weekday.short}
            </div>
          ))}
        </div>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <div key={week} className="calendar__row" role="row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const key = toDateInput(day)
              const dayPosts = byDay.get(key) ?? []
              const outside = day.getMonth() !== month.getMonth()
              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-selected={key === selectedDay}
                  className={[
                    'calendar__cell',
                    outside && 'calendar__cell--outside',
                    key === todayKey && 'calendar__cell--today',
                    key === selectedDay && 'calendar__cell--selected',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelectedDay(key)}
                >
                  <div className="calendar__cell-head">
                    <button
                      type="button"
                      className="calendar__day-number"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedDay(key)
                      }}
                      aria-label={formatDate(day, { dateStyle: 'full' })}
                    >
                      {day.getDate()}
                    </button>
                    <button
                      type="button"
                      className="calendar__add hide-mobile"
                      aria-label={t('content.addOnDay', { date: formatDate(day, { day: 'numeric', month: 'long' }) })}
                      onClick={(event) => {
                        event.stopPropagation()
                        onCreate(day)
                      }}
                    >
                      <Plus aria-hidden />
                    </button>
                  </div>
                  <div className="calendar__chips hide-mobile">
                    {dayPosts.slice(0, MAX_CHIPS).map((post) => (
                      <PostChip key={post.id} post={post} onOpen={() => onOpenPost(post)} />
                    ))}
                    {dayPosts.length > MAX_CHIPS && (
                      <span className="calendar__more">{t('content.morePosts', { count: dayPosts.length - MAX_CHIPS })}</span>
                    )}
                  </div>
                  {dayPosts.length > 0 && (
                    <div className="calendar__dots show-mobile" aria-hidden>
                      {dayPosts.slice(0, 3).map((post) => (
                        <span key={post.id} className={`calendar__dot calendar__dot--${post.status}`} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <section className="agenda" aria-live="polite">
        <div className="agenda__header">
          <h3 className="agenda__title">{formatDayLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => onCreate(selectedDate)}>
            {t('common.add')}
          </Button>
        </div>
        {selectedPosts.length === 0 ? (
          <p className="muted">{t('content.dayEmpty')}</p>
        ) : (
          <ul className="agenda__list">
            {selectedPosts.map((post) => (
              <li key={post.id}>
                <button type="button" className={`agenda-item agenda-item--${post.status}`} onClick={() => onOpenPost(post)}>
                  <span className="agenda-item__time tabular">{post.scheduled_at && formatTime(post.scheduled_at)}</span>
                  <span className="agenda-item__title" dir="auto">
                    {post.title}
                  </span>
                  <span className="agenda-item__meta">
                    {post.platforms.map((platform) => (
                      <PlatformIcon key={platform} platform={platform} />
                    ))}
                    <PostStatusBadge status={post.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PostChip({ post, onOpen }: { post: ContentPost; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`post-chip post-chip--${post.status}`}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      title={post.title}
    >
      <span className="post-chip__platforms" aria-hidden>
        {post.platforms.map((platform) => (
          <PlatformIcon key={platform} platform={platform} size={13} />
        ))}
      </span>
      {post.scheduled_at && <span className="post-chip__time tabular">{formatTime(post.scheduled_at)}</span>}
      <span className="post-chip__title" dir="auto">
        {post.title}
      </span>
    </button>
  )
}
