import { useSettings } from '../../api/hooks'

/** True when messages go out through the WhatsApp account linked by QR code. */
export function useWebMode() {
  return useSettings().data?.messaging_mode === 'web'
}
