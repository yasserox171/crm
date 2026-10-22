import { CalendarDays, MessageSquareText, MessagesSquare, UsersRound, Workflow, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  labelKey: 'nav.contacts' | 'nav.chats' | 'nav.reminders' | 'nav.automations' | 'nav.content'
  icon: LucideIcon
  /** Only shown when a WhatsApp account is linked by QR code. */
  webOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/contacts', labelKey: 'nav.contacts', icon: UsersRound },
  { to: '/chats', labelKey: 'nav.chats', icon: MessagesSquare, webOnly: true },
  { to: '/reminders', labelKey: 'nav.reminders', icon: MessageSquareText },
  { to: '/automations', labelKey: 'nav.automations', icon: Workflow },
  { to: '/content', labelKey: 'nav.content', icon: CalendarDays },
]
