import { useId } from 'react'
import type { Platform } from '../../api/types'

/** Simplified brand glyphs (lucide no longer ships brand icons). */
export function PlatformIcon({ platform, size = 16 }: { platform: Platform; size?: number }) {
  // Unique per instance: a gradient defined inside a hidden SVG would not render elsewhere.
  const gradientId = `ig-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (platform === 'facebook') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="platform-icon platform-icon--facebook">
        <circle cx="12" cy="12" r="11" fill="#1877F2" />
        <path
          d="M15.1 15.4l.4-2.9h-2.8v-1.9c0-.8.4-1.6 1.7-1.6h1.3V6.6s-1.1-.2-2.2-.2c-2.3 0-3.8 1.4-3.8 3.9v2.2H7.2v2.9h2.5v7.1c.5.1 1 .1 1.5.1s1-.04 1.5-.1v-7.1h2.4z"
          fill="#fff"
        />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="platform-icon platform-icon--instagram">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEC053" />
          <stop offset="0.5" stopColor="#F2203E" />
          <stop offset="1" stopColor="#7A33E3" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill={`url(#${gradientId})`} />
      <rect x="6" y="6" width="12" height="12" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.3" cy="7.7" r="0.9" fill="#fff" />
    </svg>
  )
}
