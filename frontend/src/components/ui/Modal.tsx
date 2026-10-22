import { X } from 'lucide-react'
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  footer?: ReactNode
  /** When set, body and footer are wrapped in a <form>. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  /** Prevents closing with Esc / backdrop while something is in flight. */
  busy?: boolean
  /** Render children as-is (they provide their own .modal__body / .modal__footer). */
  custom?: boolean
}

/** Accessible modal built on the native <dialog> (focus trap, Esc, top layer). Bottom sheet on phones. */
export function Modal({ open, onClose, title, description, size = 'md', children, footer, onSubmit, busy, custom }: ModalProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const pressStartedOnBackdrop = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const requestClose = () => {
    if (!busy) onClose()
  }

  const content = custom ? (
    children
  ) : (
    <>
      <div className="modal__body">{children}</div>
      {footer && <div className="modal__footer">{footer}</div>}
    </>
  )

  return (
    <dialog
      ref={ref}
      className={`modal${size !== 'md' ? ` modal--${size}` : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // A nested dialog's Esc must not close this one too.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        requestClose()
      }}
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) requestClose()
      }}
    >
      {open && (
        <>
          <div className="modal__header">
            <div>
              <h2 id={titleId} className="modal__title">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="modal__description">
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              onClick={requestClose}
              aria-label={t('common.close')}
            >
              <X aria-hidden />
            </button>
          </div>
          {onSubmit ? (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                onSubmit(event)
              }}
              style={{ display: 'contents' }}
            >
              {content}
            </form>
          ) : (
            content
          )}
        </>
      )}
    </dialog>
  )
}
