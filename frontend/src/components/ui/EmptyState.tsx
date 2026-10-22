import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  text?: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon, title, text, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty${compact ? ' empty--compact' : ''}`}>
      <div className="empty__icon" aria-hidden>
        {icon}
      </div>
      <p className="empty__title">{title}</p>
      {text && <p className="empty__text">{text}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  )
}
