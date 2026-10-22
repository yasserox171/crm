import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface TagInputProps {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({ id, value, onChange, placeholder }: TagInputProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const commit = () => {
    const tag = draft.trim().replace(/,$/, '').slice(0, 40)
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button
            type="button"
            className="chip__remove"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            aria-label={`${t('common.delete')} ${tag}`}
          >
            <X aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="tag-input__field"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length ? '' : placeholder}
      />
    </div>
  )
}
