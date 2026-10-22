export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonClassOptions {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  iconOnly?: boolean
  block?: boolean
}

/** Button classes, also used to style links as buttons. */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  block = false,
}: ButtonClassOptions = {}) {
  return ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm', iconOnly && 'btn--icon', block && 'btn--block']
    .filter(Boolean)
    .join(' ')
}
