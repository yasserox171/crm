import { useEffect, useId, useRef, type ComponentProps, type InputHTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  optional?: boolean
  className?: string
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__optional"> ({t('common.optional')})</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? messageId : undefined })}
      {error ? (
        <p id={messageId} className="field__error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="field__hint">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={['input', className].filter(Boolean).join(' ')} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={['select', className].filter(Boolean).join(' ')} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={['textarea', className].filter(Boolean).join(' ')} {...props} />
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  indeterminate?: boolean
}

export function Checkbox({ indeterminate = false, className, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input ref={ref} type="checkbox" className={['checkbox', className].filter(Boolean).join(' ')} {...props} />
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}
