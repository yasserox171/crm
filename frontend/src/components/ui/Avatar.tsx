function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  return (
    <span className={`avatar${size === 'lg' ? ' avatar--lg' : ''}`} aria-hidden>
      {initials(name)}
    </span>
  )
}
