export const CONTACT_STATUSES = ['new', 'interested', 'appointment_set', 'attended', 'no_answer', 'enrolled'] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

export const CONTACT_SOURCES = ['ad', 'whatsapp', 'paper', 'legacy'] as const
export type ContactSource = (typeof CONTACT_SOURCES)[number]

export const SCHOOL_LEVELS = ['primary', 'middle', 'common_core', 'bac_1', 'bac_2', 'higher', 'adult', 'other'] as const
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number]

export const APPOINTMENT_STATUSES = ['scheduled', 'attended', 'no_show', 'cancelled'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export type DeliveryStatus = 'pending' | 'sent' | 'failed'
export type MessagePurpose = 'reminder' | 'automation' | 'manual'
export type InteractionKind = 'whatsapp_out' | 'whatsapp_in' | 'call' | 'appointment' | 'note' | 'status_change'

export const TRIGGERS = ['contact_created', 'status_is', 'appointment_no_show', 'no_interaction'] as const
export type Trigger = (typeof TRIGGERS)[number]
export const ACTIONS = ['send_whatsapp', 'change_status', 'add_tag'] as const
export type Action = (typeof ACTIONS)[number]
export const DELAY_UNITS = ['minutes', 'hours', 'days'] as const
export type DelayUnit = (typeof DELAY_UNITS)[number]

export const POST_STATUSES = ['draft', 'scheduled', 'published'] as const
export type PostStatus = (typeof POST_STATUSES)[number]
export const MEDIA_TYPES = ['text', 'image', 'video'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]
export const PLATFORMS = ['facebook', 'instagram'] as const
export type Platform = (typeof PLATFORMS)[number]

export type Locale = 'fr' | 'ar' | 'en'

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface User {
  id: number
  email: string
  first_name: string
  last_name: string
  display_name: string
  preferred_language: Locale
}

export interface ContactSummary {
  id: number
  first_name: string
  last_name: string
  full_name: string
  phone: string
  phone_display: string
  status: ContactStatus
  consent: boolean
}

export interface Contact extends ContactSummary {
  city: string
  subject: string
  level: SchoolLevel | ''
  status_changed_at: string
  source: ContactSource
  consent_at: string | null
  /** Taken out of every automation (changed via /automations/exclusions/). */
  automations_excluded: boolean
  automations_excluded_at: string | null
  tags: string[]
  registered_at: string
  next_appointment: { id: number; scheduled_at: string; title: string } | null
  created_at: string
  updated_at: string
}

export type ContactInput = Pick<
  Contact,
  'first_name' | 'last_name' | 'phone' | 'city' | 'subject' | 'level' | 'status' | 'source' | 'consent' | 'tags' | 'registered_at'
>

export interface ContactStats {
  total: number
  by_status: Record<ContactStatus, number>
  by_source: Record<ContactSource, number>
}

export interface Interaction {
  id: number
  contact: number
  kind: InteractionKind
  body: string
  purpose: MessagePurpose | ''
  delivery_status: DeliveryStatus | null
  sent_at: string | null
  error: string
  batch_id: string | null
  appointment: number | null
  appointment_at: string | null
  rule: number | null
  rule_name: string | null
  metadata: {
    event?: 'created' | 'rescheduled' | AppointmentStatus
    from?: ContactStatus | string | null
    to?: ContactStatus
    source?: ContactSource
    scheduled_at?: string
  }
  created_by_name: string | null
  created_at: string
}

export interface Appointment {
  id: number
  contact: number
  contact_detail: ContactSummary
  title: string
  scheduled_at: string
  duration_minutes: number
  notes: string
  status: AppointmentStatus
  last_reminder_at: string | null
  created_at: string
}

export type AppointmentInput = Pick<Appointment, 'contact' | 'title' | 'scheduled_at' | 'duration_minutes' | 'notes'> & {
  status?: AppointmentStatus
}

export interface Message {
  id: number
  contact: ContactSummary
  body: string
  purpose: MessagePurpose | ''
  delivery_status: DeliveryStatus
  sent_manually: boolean
  sent_at: string | null
  error: string
  attempts: number
  batch_id: string | null
  appointment: number | null
  appointment_at: string | null
  created_at: string
}

export interface ReminderPreview {
  messages: { appointment_id: number; contact_name: string | null; body: string; skipped_reason: string | null }[]
  variables: string[]
}

export interface ReminderSendResult {
  batch_id: string | null
  queued: number
  skipped: { appointment_id: number; reason: string }[]
}

export interface Batch {
  batch_id: string
  counts: Record<DeliveryStatus, number>
  messages: Message[]
}

/** A contact as listed in the automations' audience. */
export type AudienceContact = Pick<ContactSummary, 'id' | 'full_name' | 'phone' | 'status'>

export interface PlannedAction {
  rule: number
  rule_name: string
  action: Action
  due_at: string
}

/** One contact in a rule form's "Pour" list. */
export interface RuleContact extends AudienceContact {
  consent: boolean
  /** Excluded from every automation (contact page / "Contacts concernés"). */
  automations_excluded: boolean
  /** Soonest action this rule has planned for the contact (ignoring the rule's own exclusions). */
  due_at: string | null
}

export interface AutomationAudience {
  /** Contacts an active rule is about to act on, soonest first. */
  upcoming: { contact: AudienceContact; actions: PlannedAction[] }[]
  upcoming_total: number
  excluded: (AudienceContact & { excluded_at: string | null })[]
  excluded_total: number
}

export interface AppSettings {
  automations_paused: boolean
  paused_at: string | null
  reminder_template: string
  message_locale: Locale
  whatsapp_live: boolean
  /** live = WhatsApp API · web = linked account (QR) · manual = sent by hand · test = logged only */
  messaging_mode: 'live' | 'web' | 'manual' | 'test'
  updated_at: string
}

export interface FollowUpRule {
  id: number
  name: string
  trigger: Trigger
  trigger_status: ContactStatus | ''
  action: Action
  action_status: ContactStatus | ''
  action_tag: string
  message_template: string
  delay_amount: number
  delay_unit: DelayUnit
  is_active: boolean
  /** Contact ids this rule never applies to. */
  excluded_contacts: number[]
  activated_at: string
  last_run_at: string | null
  run_count: number
  executions_skipped: number
  created_at: string
}

export type FollowUpRuleInput = Omit<FollowUpRule, 'id' | 'activated_at' | 'last_run_at' | 'run_count' | 'executions_skipped' | 'created_at'>

export interface ContentPost {
  id: number
  title: string
  body: string
  platforms: Platform[]
  media_type: MediaType
  media_url: string | null
  status: PostStatus
  scheduled_at: string | null
  published_at: string | null
  ai_generated: boolean
  created_at: string
  updated_at: string
}

export interface GeneratedPost {
  title: string
  body: string
  hashtags: string[]
}

/** Who a manual WhatsApp message goes to: explicit contacts, or every contact matching the list filters. */
export type ContactSelection =
  | { contact_ids: number[] }
  | { filters: { search?: string; status?: string; source?: string } }

export interface BulkPreview {
  eligible: number
  no_consent: number
  max_recipients: number
  sample: { first_name: string; last_name: string; full_name: string } | null
}

export interface BulkSendResult {
  batch_id: string | null
  queued: number
  skipped_no_consent: number
}

/** The WhatsApp account linked by QR code (MESSAGING_BACKEND=whatsapp_web). */
export interface WhatsAppStatus {
  enabled: boolean
  state?: 'initializing' | 'qr' | 'connected' | 'disconnected' | 'unreachable'
  qr?: string | null
  me?: { phone: string; name: string } | null
  sent_today?: number
  daily_limit?: number
  min_delay?: number
  max_delay?: number
  pending?: number
}

/** A one-to-one WhatsApp chat of the linked account (read live, never stored). */
export interface WaChat {
  id: string
  name: string | null
  unread: number
  t: number | null
  phone: string | null
  last: { body: string; type: string; fromMe: boolean; t: number | null } | null
  contact: { id: number; full_name: string; status: ContactStatus } | null
}

export interface WaMessage {
  id: string
  fromMe: boolean
  body: string
  type: string
  t: number | null
  /** 0 pending · 1 sent · 2 delivered · 3+ read */
  ack: number | null
}
