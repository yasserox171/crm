import { useSettings } from '../../api/hooks'

/** True when messages are sent by hand from WhatsApp (no WhatsApp API connected). */
export function useManualMode() {
  return useSettings().data?.messaging_mode === 'manual'
}
