import { Archive, FileText, Megaphone, MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ContactSource, ContactStatus, DeliveryStatus, PostStatus } from '../../api/types'

export function StatusBadge({ status }: { status: ContactStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`badge badge--${status}`}>
      <span className="badge__dot" aria-hidden />
      {t(`status.${status}`)}
    </span>
  )
}

export function DeliveryBadge({ status, manual = false }: { status: DeliveryStatus; manual?: boolean }) {
  const { t } = useTranslation()
  return (
    <span className={`badge badge--${status}`}>
      <span className="badge__dot" aria-hidden />
      {manual && status === 'pending' ? t('delivery.toSend') : t(`delivery.${status}`)}
    </span>
  )
}

export function PostStatusBadge({ status }: { status: PostStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`badge badge--${status}`}>
      <span className="badge__dot" aria-hidden />
      {t(`postStatus.${status}`)}
    </span>
  )
}

const SOURCE_ICONS = { ad: Megaphone, whatsapp: MessageCircle, paper: FileText, legacy: Archive } as const

export function SourceTag({ source }: { source: ContactSource }) {
  const { t } = useTranslation()
  const Icon = SOURCE_ICONS[source]
  return (
    <span className={`tag tag--${source}`}>
      <Icon aria-hidden />
      {t(`source.${source}`)}
    </span>
  )
}
