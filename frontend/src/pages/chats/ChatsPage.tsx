import { ArrowLeft, Check, CheckCheck, Clock3, ExternalLink, MessagesSquare, Search, Send, UserPlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { ApiError, errorMessage } from '../../api/client'
import { useWaChats, useWaMessages, useWaReply, useWhatsAppStatus } from '../../api/hooks'
import type { WaChat, WaMessage } from '../../api/types'
import { MessagingModeBanner } from '../../components/messaging/MessagingModeBanner'
import { useWebMode } from '../../components/messaging/useWebMode'
import { Avatar } from '../../components/ui/Avatar'
import { StatusBadge } from '../../components/ui/Badges'
import { Button } from '../../components/ui/Button'
import { buttonClass } from '../../components/ui/buttonClass'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Form'
import { PhoneNumber } from '../../components/ui/PhoneNumber'
import { PageLoader, Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatDate, formatDayLabel, formatTime, toDateInput } from '../../lib/format'
import { ContactFormModal } from '../contacts/ContactFormModal'

const MEDIA_TYPES = ['image', 'video', 'ptt', 'audio', 'document', 'sticker', 'location', 'vcard', 'revoked', 'album'] as const
type MediaType = (typeof MEDIA_TYPES)[number]
const TEXT_TYPES = new Set(['chat', 'automated_greeting_message', 'away_message'])

const fromUnix = (t: number | null) => (t ? new Date(t * 1000) : null)

/** Text of a message, or a short label for media ("📷 Photo", with its caption). */
function useMessageText() {
  const { t } = useTranslation()
  return (message: { type: string; body: string }) => {
    if (TEXT_TYPES.has(message.type)) return message.body
    const label = MEDIA_TYPES.includes(message.type as MediaType)
      ? t(`chats.media.${message.type as MediaType}`)
      : t('chats.media.other', { type: message.type })
    return message.body ? `${label} · ${message.body}` : label
  }
}

export default function ChatsPage() {
  const { t } = useTranslation()
  const { chatId } = useParams()
  const web = useWebMode()
  const connected = useWhatsAppStatus(web).data?.state === 'connected'
  const chats = useWaChats(web && connected)
  const [query, setQuery] = useState('')

  if (!web) {
    return (
      <div className="page">
        <EmptyState icon={<MessagesSquare />} title={t('chats.title')} text={t('wa.disabled')} />
      </div>
    )
  }

  const needle = query.trim().toLowerCase()
  const digits = needle.replace(/\D/g, '')
  const list = (chats.data ?? []).filter(
    (chat) =>
      !needle ||
      (chat.contact?.full_name ?? chat.name ?? '').toLowerCase().includes(needle) ||
      (digits.length >= 3 && (chat.phone ?? '').includes(digits)),
  )
  const selected = chats.data?.find((chat) => chat.id === chatId)

  return (
    <div className={`chats${chatId ? ' chats--open' : ''}`}>
      {!connected && (
        <div className="chats__banner">
          <MessagingModeBanner />
        </div>
      )}
      <aside className="chats__list" aria-label={t('chats.title')}>
        <div className="chats__list-header">
          <h1 className="chats__title">{t('chats.title')}</h1>
          <div className="input-group">
            <Search className="input-group__icon" aria-hidden />
            <Input
              type="search"
              className="input--with-icon"
              placeholder={t('chats.search')}
              aria-label={t('chats.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {chats.isPending && connected ? (
          <PageLoader />
        ) : list.length === 0 ? (
          <p className="muted chats__empty">{t('chats.empty')}</p>
        ) : (
          <ul className="chat-list">
            {list.map((chat) => (
              <li key={chat.id}>
                <ChatListItem chat={chat} />
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="chats__conversation">
        {chatId ? (
          <Conversation key={chatId} chatId={chatId} chat={selected} />
        ) : (
          <EmptyState icon={<MessagesSquare />} title={t('chats.title')} text={t('chats.select')} />
        )}
      </section>
    </div>
  )
}

function ChatListItem({ chat }: { chat: WaChat }) {
  const { t } = useTranslation()
  const text = useMessageText()
  const name = chat.contact?.full_name ?? chat.name ?? (chat.phone ? `+${chat.phone}` : '—')
  const when = fromUnix(chat.last?.t ?? chat.t)
  const isToday = when && toDateInput(when) === toDateInput(new Date())
  return (
    <NavLink to={`/chats/${encodeURIComponent(chat.id)}`} className="chat-item">
      <Avatar name={name} />
      <span className="chat-item__main">
        <span className="chat-item__top">
          {/* Page direction for alignment; <bdi> keeps a Latin name intact in the Arabic UI. */}
          <span className="chat-item__name">
            <bdi>{name}</bdi>
          </span>
          {when && (
            <span className="chat-item__time tabular">{isToday ? formatTime(when) : formatDate(when, { day: 'numeric', month: 'short' })}</span>
          )}
        </span>
        <span className="chat-item__bottom">
          <span className="chat-item__preview">
            {chat.last ? (
              <>
                {chat.last.fromMe && t('chats.you')}
                {/* Isolated so a French message keeps its punctuation in the Arabic UI (and vice versa). */}
                <bdi>{text(chat.last)}</bdi>
              </>
            ) : (
              ' '
            )}
          </span>
          {chat.unread > 0 && (
            <span className="chat-item__unread tabular" aria-label={t('chats.unread', { count: chat.unread })}>
              {chat.unread}
            </span>
          )}
        </span>
        {chat.contact && <StatusBadge status={chat.contact.status} />}
      </span>
    </NavLink>
  )
}

function Conversation({ chatId, chat }: { chatId: string; chat?: WaChat }) {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const messages = useWaMessages(chatId)
  const send = useWaReply(chatId)
  const text = useMessageText()
  const [draft, setDraft] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const name = chat?.contact?.full_name ?? chat?.name ?? (chat?.phone ? `+${chat.phone}` : '…')

  // Stay at the bottom when new messages arrive, unless the user scrolled up to read.
  const count = messages.data?.length ?? 0
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight
  }, [count])
  useEffect(() => {
    stickToBottom.current = true
  }, [chatId])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || send.isPending) return
    send.mutate(body, {
      onSuccess: () => {
        setDraft('')
        stickToBottom.current = true
      },
      onError: (error) =>
        toast.error(error instanceof ApiError && error.code === 'daily_limit' ? t('chats.dailyLimit') : errorMessage(error)),
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  // Group messages by day for the separators.
  const groups: { day: string; date: Date; items: WaMessage[] }[] = []
  for (const message of messages.data ?? []) {
    const date = fromUnix(message.t) ?? new Date()
    const day = toDateInput(date)
    const group = groups[groups.length - 1]
    if (group?.day === day) group.items.push(message)
    else groups.push({ day, date, items: [message] })
  }

  return (
    <div className="conversation">
      <header className="conversation__header">
        <Button className="show-mobile" variant="ghost" iconOnly label={t('chats.back')} icon={<ArrowLeft className="flip-rtl" aria-hidden />} onClick={() => navigate('/chats')} />
        <Avatar name={name} />
        <div className="conversation__who">
          <span className="conversation__name">
            <bdi>{name}</bdi>
          </span>
          {chat?.phone && <PhoneNumber value={`+${chat.phone}`} className="subtle" />}
        </div>
        {chat?.contact ? (
          <Link to={`/contacts/${chat.contact.id}`} className={buttonClass({ size: 'sm' })}>
            <ExternalLink aria-hidden />
            <span className="hide-mobile">{t('chats.openContact')}</span>
          </Link>
        ) : (
          chat?.phone && (
            <Button size="sm" icon={<UserPlus aria-hidden />} onClick={() => setAddOpen(true)}>
              <span className="hide-mobile">{t('chats.addContact')}</span>
            </Button>
          )
        )}
      </header>

      <div
        ref={scrollRef}
        className="conversation__messages"
        onScroll={(event) => {
          const box = event.currentTarget
          stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80
        }}
      >
        {messages.isPending ? (
          <PageLoader />
        ) : messages.isError ? (
          <p className="field__error conversation__note">{errorMessage(messages.error)}</p>
        ) : groups.length === 0 ? (
          <p className="muted conversation__note">{t('chats.noMessages')}</p>
        ) : (
          groups.map((group) => (
            <section key={group.day} className="conversation__day">
              <h3 className="conversation__day-label">
                <span>{formatDayLabel(group.date, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </h3>
              {group.items.map((message) => (
                <div key={message.id} className={`chat-bubble chat-bubble--${message.fromMe ? 'out' : 'in'}`}>
                  <p dir="auto">{text(message)}</p>
                  <span className="chat-bubble__meta tabular">
                    {message.t && formatTime(new Date(message.t * 1000))}
                    {message.fromMe && <Ack ack={message.ack} />}
                  </span>
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      <form className="conversation__composer" onSubmit={submit}>
        <textarea
          className="textarea conversation__input"
          dir="auto"
          rows={1}
          placeholder={t('chats.placeholder')}
          aria-label={t('chats.placeholder')}
          value={draft}
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" variant="primary" iconOnly label={t('chats.send')} icon={send.isPending ? <Spinner /> : <Send className="flip-rtl" aria-hidden />} disabled={!draft.trim() || send.isPending} />
      </form>
      <p className="conversation__hint subtle hide-mobile">
        {t('chats.enterHint')} · {t('chats.loggedHint')}
      </p>

      {chat?.phone && (
        <ContactFormModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          initial={{ first_name: chat.name ?? '', phone: `+${chat.phone}`, source: 'whatsapp' }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['wa', 'chats'] })}
        />
      )}
    </div>
  )
}

function Ack({ ack }: { ack: number | null }) {
  const { t } = useTranslation()
  if (ack === null || ack <= 0) return <Clock3 className="chat-bubble__ack" aria-label={t('delivery.pending')} />
  if (ack === 1) return <Check className="chat-bubble__ack" aria-label={t('delivery.sent')} />
  return <CheckCheck className={`chat-bubble__ack${ack >= 3 ? ' chat-bubble__ack--read' : ''}`} aria-label={t('delivery.sent')} />
}
