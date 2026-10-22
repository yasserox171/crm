import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AppSettings,
  Appointment,
  AppointmentInput,
  AutomationAudience,
  Batch,
  BulkPreview,
  BulkSendResult,
  Contact,
  ContactInput,
  ContactSelection,
  ContactStats,
  ContentPost,
  FollowUpRule,
  FollowUpRuleInput,
  GeneratedPost,
  Interaction,
  Locale,
  Message,
  Paginated,
  ReminderPreview,
  ReminderSendResult,
  RuleContact,
  User,
  WaChat,
  WaMessage,
  WhatsAppStatus,
} from './types'

export const keys = {
  me: ['me'] as const,
  contacts: ['contacts'] as const,
  contactList: (params: object) => ['contacts', 'list', params] as const,
  contactStats: (params: object) => ['contacts', 'stats', params] as const,
  contact: (id: number) => ['contacts', 'detail', id] as const,
  timeline: (id: number) => ['contacts', 'timeline', id] as const,
  appointments: ['appointments'] as const,
  messages: ['messages'] as const,
  batch: (id: string) => ['messages', 'batch', id] as const,
  settings: ['settings'] as const,
  rules: ['rules'] as const,
  // Under `rules` so that editing or toggling a rule refreshes it too.
  audience: ['rules', 'audience'] as const,
  posts: ['posts'] as const,
}

// --- Auth -----------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<User>('/auth/me/')
      } catch (error) {
        if ((error as { status?: number }).status === 403) return null
        throw error
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      await api.get('/auth/csrf/')
      return api.post<User>('/auth/login/', credentials)
    },
    onSuccess: (user) => {
      queryClient.clear()
      queryClient.setQueryData(keys.me, user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/auth/logout/'),
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(keys.me, null)
    },
  })
}

export function useUpdateLanguage() {
  return useMutation({
    mutationFn: (preferred_language: Locale) => api.patch<User>('/auth/me/', { preferred_language }),
  })
}

// --- Contacts -------------------------------------------------------------

export interface ContactListParams {
  search?: string
  status?: string
  source?: string
  ordering?: string
  page?: number
}

export function useContacts(params: ContactListParams) {
  return useQuery({
    queryKey: keys.contactList(params),
    queryFn: () => api.get<Paginated<Contact>>('/contacts/', { ...params }),
    placeholderData: keepPreviousData,
  })
}

/** Small search for pickers (needs 2+ characters). */
export function useContactSearch(search: string) {
  const params = { search, page_size: 6 }
  return useQuery({
    queryKey: keys.contactList(params),
    queryFn: () => api.get<Paginated<Contact>>('/contacts/', params),
    enabled: search.length >= 2,
    placeholderData: keepPreviousData,
  })
}

export function useContactStats(params: Omit<ContactListParams, 'page' | 'ordering'>) {
  return useQuery({
    queryKey: keys.contactStats(params),
    queryFn: () => api.get<ContactStats>('/contacts/stats/', { ...params }),
    placeholderData: keepPreviousData,
  })
}

export function useContact(id: number) {
  return useQuery({ queryKey: keys.contact(id), queryFn: () => api.get<Contact>(`/contacts/${id}/`) })
}

export function useFindByPhone(phone: string | null, excludeId?: number) {
  return useQuery({
    queryKey: ['contacts', 'phone', phone],
    queryFn: () => api.get<Paginated<Contact>>('/contacts/', { phone: phone ?? '' }),
    enabled: !!phone,
    select: (data) => data.results.find((contact) => contact.id !== excludeId) ?? null,
  })
}

export function useSaveContact(id?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<ContactInput>) =>
      id ? api.patch<Contact>(`/contacts/${id}/`, data) : api.post<Contact>('/contacts/', data),
    onSuccess: (contact) => {
      queryClient.setQueryData(keys.contact(contact.id), contact)
      queryClient.invalidateQueries({ queryKey: keys.contacts })
    },
  })
}

export function useDeleteContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/contacts/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.contacts })
      queryClient.invalidateQueries({ queryKey: keys.appointments })
    },
  })
}

export function useTimeline(id: number) {
  return useQuery({ queryKey: keys.timeline(id), queryFn: () => api.get<Interaction[]>(`/contacts/${id}/timeline/`) })
}

export function useAddNote(contactId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.post<Interaction>(`/contacts/${contactId}/notes/`, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.timeline(contactId) }),
  })
}

// --- Appointments ---------------------------------------------------------

export interface AppointmentParams {
  contact?: number
  upcoming?: boolean
  start?: string
  end?: string
  status?: string
}

export function useAppointments(params: AppointmentParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...keys.appointments, params],
    queryFn: () => api.get<Appointment[]>('/appointments/', { ...params }),
    ...options,
  })
}

export function useSaveAppointment(id?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AppointmentInput>) =>
      id ? api.patch<Appointment>(`/appointments/${id}/`, data) : api.post<Appointment>('/appointments/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.appointments })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
    },
  })
}

export function useDeleteAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/appointments/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.appointments })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
    },
  })
}

// --- Reminders & messages -------------------------------------------------

export function useReminderPreview(appointmentIds: number[], template: string, locale: Locale) {
  return useQuery({
    queryKey: ['reminder-preview', appointmentIds, template, locale],
    queryFn: () => api.post<ReminderPreview>('/reminders/preview/', { appointment_ids: appointmentIds, template }),
    enabled: appointmentIds.length > 0 && template.trim().length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useSendReminders() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { appointment_ids: number[]; template: string; save_template: boolean }) =>
      api.post<ReminderSendResult>('/reminders/send/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.messages })
      queryClient.invalidateQueries({ queryKey: keys.settings })
    },
  })
}

export function useBatch(batchId: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: keys.batch(batchId ?? ''),
    queryFn: async () => {
      const batch = await api.get<Batch>(`/messages/batches/${batchId}/`)
      if (batch.counts.pending === 0) {
        queryClient.invalidateQueries({ queryKey: keys.appointments })
        queryClient.invalidateQueries({ queryKey: ['messages', 'list'] })
      }
      return batch
    },
    enabled: !!batchId,
    refetchInterval: (query) => (query.state.data && query.state.data.counts.pending === 0 ? false : 2000),
  })
}

export function useMessages(params: { purpose?: string; page_size?: number }) {
  return useQuery({
    queryKey: ['messages', 'list', params],
    queryFn: () => api.get<Paginated<Message>>('/messages/', params),
  })
}

export function useBulkPreview(selection: ContactSelection, enabled: boolean) {
  return useQuery({
    queryKey: ['messages', 'preview', selection],
    queryFn: () => api.post<BulkPreview>('/messages/preview/', selection),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useBulkSend() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ContactSelection & { body: string }) => api.post<BulkSendResult>('/messages/send/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'list'] })
      queryClient.invalidateQueries({ queryKey: ['contacts', 'timeline'] })
    },
  })
}

/** Manual mode: messages waiting to be sent from WhatsApp, oldest first. */
export function useOutbox(enabled: boolean) {
  return useQuery({
    queryKey: ['messages', 'outbox'],
    queryFn: () => api.get<Paginated<Message>>('/messages/', { delivery_status: 'pending', ordering: 'created_at', page_size: 100 }),
    enabled,
    refetchInterval: 30_000,
  })
}

function useMessageAction(action: 'mark-sent' | 'mark-pending' | 'cancel') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<Message>(`/messages/${id}/${action}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.messages })
      queryClient.invalidateQueries({ queryKey: keys.appointments })
      queryClient.invalidateQueries({ queryKey: ['contacts', 'timeline'] })
    },
  })
}

export const useMarkSent = () => useMessageAction('mark-sent')
export const useMarkPending = () => useMessageAction('mark-pending')
export const useCancelMessage = () => useMessageAction('cancel')

export function useRetryMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<Message>(`/messages/${id}/retry/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.messages }),
  })
}

// --- Settings & automations -----------------------------------------------

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<AppSettings>('/settings/') })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AppSettings>) => api.patch<AppSettings>('/settings/', data),
    onSuccess: (settings) => queryClient.setQueryData(keys.settings, settings),
  })
}

export function useRules() {
  return useQuery({ queryKey: keys.rules, queryFn: () => api.get<FollowUpRule[]>('/automations/rules/') })
}

export function useSaveRule(id?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<FollowUpRuleInput>) =>
      id ? api.patch<FollowUpRule>(`/automations/rules/${id}/`, data) : api.post<FollowUpRule>('/automations/rules/', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.rules }),
  })
}

export function useToggleRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch<FollowUpRule>(`/automations/rules/${id}/`, { is_active }),
    onMutate: async ({ id, is_active }) => {
      await queryClient.cancelQueries({ queryKey: keys.rules })
      const previous = queryClient.getQueryData<FollowUpRule[]>(keys.rules)
      queryClient.setQueryData<FollowUpRule[]>(keys.rules, (rules) =>
        rules?.map((rule) => (rule.id === id ? { ...rule, is_active } : rule)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(keys.rules, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.rules }),
  })
}

export function useDeleteRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/automations/rules/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.rules }),
  })
}

/** Contacts for a rule form (`ruleId` undefined while creating a rule). */
export function useRuleContacts(ruleId?: number) {
  return useQuery({
    queryKey: [...keys.rules, 'contacts', ruleId ?? 'new'],
    queryFn: () => api.get<RuleContact[]>('/automations/rules/contacts/', ruleId ? { rule: ruleId } : {}),
  })
}

export function useAutomationAudience() {
  return useQuery({
    queryKey: keys.audience,
    queryFn: () => api.get<AutomationAudience>('/automations/audience/'),
    refetchInterval: 60_000,
  })
}

/** Exclude contacts from every automation (or bring them back). */
export function useSetAutomationExclusion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { contact_ids: number[]; excluded: boolean }) =>
      api.post<{ updated: number; cancelled: number }>('/automations/exclusions/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.audience })
      queryClient.invalidateQueries({ queryKey: keys.contacts })
      queryClient.invalidateQueries({ queryKey: keys.messages })
    },
  })
}

// --- Content --------------------------------------------------------------

export function useMonthPosts(month: string) {
  return useQuery({
    queryKey: [...keys.posts, 'month', month],
    queryFn: () => api.get<ContentPost[]>('/content/posts/', { month }),
    placeholderData: keepPreviousData,
  })
}

export function useLibrary(params: { media_type?: string; page: number }) {
  return useQuery({
    queryKey: [...keys.posts, 'library', params],
    queryFn: () => api.get<Paginated<ContentPost>>('/content/posts/', { ...params, page_size: 24 }),
    placeholderData: keepPreviousData,
  })
}

export function useSavePost(id?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: FormData) =>
      id ? api.patch<ContentPost>(`/content/posts/${id}/`, data) : api.post<ContentPost>('/content/posts/', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.posts }),
  })
}

export function useDeletePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/content/posts/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.posts }),
  })
}

export function useGeneratePost() {
  return useMutation({
    mutationFn: (data: { brief: string; platform: string; tone: string; language: Locale; media_type: string }) =>
      api.post<GeneratedPost>('/content/posts/generate/', data),
  })
}

// --- Linked WhatsApp account -------------------------------------------------

/** Polls quickly (3 s) while a QR code is waiting to be scanned on the WhatsApp page, slowly elsewhere. */
export function useWhatsAppStatus(enabled: boolean, fast = false) {
  return useQuery({
    queryKey: ['whatsapp', 'status'],
    queryFn: () => api.get<WhatsAppStatus>('/whatsapp/status/'),
    enabled,
    refetchInterval: (query) => (fast && query.state.data?.state !== 'connected' ? 3_000 : 30_000),
  })
}

export function useWhatsAppLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/whatsapp/logout/'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp'] }),
  })
}

// --- WhatsApp inbox (linked account) -----------------------------------------

const chatPath = (chatId: string) => `/whatsapp/chats/${encodeURIComponent(chatId)}`

export function useWaChats(enabled: boolean) {
  return useQuery({
    queryKey: ['wa', 'chats'],
    queryFn: () => api.get<{ chats: WaChat[] }>('/whatsapp/chats/'),
    enabled,
    refetchInterval: 15_000,
    select: (data) => data.chats,
  })
}

export function useWaMessages(chatId: string | undefined) {
  return useQuery({
    queryKey: ['wa', 'messages', chatId],
    queryFn: () => api.get<{ messages: WaMessage[] }>(`${chatPath(chatId!)}/messages/`),
    enabled: !!chatId,
    refetchInterval: 4_000,
    select: (data) => data.messages,
  })
}

export function useWaReply(chatId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.post<{ id: string; logged: number }>(`${chatPath(chatId!)}/reply/`, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wa'] })
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['contacts', 'timeline'] })
    },
  })
}

