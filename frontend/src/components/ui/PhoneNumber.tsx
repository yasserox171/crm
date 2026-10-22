import { formatPhone } from '../../lib/phone'

/** Always "+212 6XX XXXXXX", kept left-to-right inside Arabic text. */
export function PhoneNumber({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" className={['ltr tabular', className].filter(Boolean).join(' ')}>
      {formatPhone(value)}
    </bdi>
  )
}
