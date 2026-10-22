import { Copy, FileText, Film, Image as ImageIcon, PenLine, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, errorMessage } from '../../api/client'
import { useDeletePost, useGeneratePost, useSavePost } from '../../api/hooks'
import { PLATFORMS, type ContentPost, type Locale, type MediaType, type Platform, type PostStatus } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '../../components/ui/Form'
import { Modal } from '../../components/ui/Modal'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { useToast } from '../../components/ui/Toast'
import { currentLanguage } from '../../i18n'
import { combineDateTime, toDateInput, toTimeInput } from '../../lib/format'

const MAX_CHARS = 2200
const ACCEPT: Record<Exclude<MediaType, 'text'>, string> = {
  image: 'image/jpeg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/quicktime,video/webm',
}

interface PostEditorModalProps {
  open: boolean
  onClose: () => void
  post?: ContentPost
  defaultDate?: Date
}

export function PostEditorModal({ open, onClose, post, defaultDate }: PostEditorModalProps) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={post ? t('post.editTitle') : t('post.createTitle')} size="lg" custom>
      <PostEditor post={post} defaultDate={defaultDate} onClose={onClose} />
    </Modal>
  )
}

type Errors = Partial<Record<'title' | 'platforms' | 'scheduled_at' | 'media' | 'body', string>>

function PostEditor({ post, defaultDate, onClose }: Omit<PostEditorModalProps, 'open'>) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSavePost(post?.id)
  const remove = useDeletePost()
  const generate = useGeneratePost()
  const fileInput = useRef<HTMLInputElement>(null)

  const initialDate = post?.scheduled_at ? new Date(post.scheduled_at) : defaultDate ? withHour(defaultDate, 18) : null
  const [mode, setMode] = useState<'manual' | 'ai'>('manual')
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [platforms, setPlatforms] = useState<Platform[]>(post?.platforms ?? ['facebook', 'instagram'])
  const [mediaType, setMediaType] = useState<MediaType>(post?.media_type ?? 'text')
  const [file, setFile] = useState<File | null>(null)
  const [removeMedia, setRemoveMedia] = useState(false)
  const [status, setStatus] = useState<PostStatus>(post?.status ?? (defaultDate ? 'scheduled' : 'draft'))
  const [date, setDate] = useState(initialDate ? toDateInput(initialDate) : '')
  const [time, setTime] = useState(initialDate ? toTimeInput(initialDate) : '18:00')
  const [aiGenerated, setAiGenerated] = useState(post?.ai_generated ?? false)
  const [errors, setErrors] = useState<Errors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  // AI brief
  const [brief, setBrief] = useState('')
  const [aiPlatform, setAiPlatform] = useState<'both' | Platform>('both')
  const [tone, setTone] = useState<'friendly' | 'professional' | 'energetic'>('friendly')
  const [language, setLanguage] = useState<Locale>(currentLanguage())
  const [aiNotice, setAiNotice] = useState<string | null>(null)

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])
  const existingMedia = !removeMedia && post?.media_url && post.media_type === mediaType ? post.media_url : null
  const mediaSrc = previewUrl ?? existingMedia

  const togglePlatform = (platform: Platform) => {
    setPlatforms((current) => (current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform]))
    setErrors((current) => ({ ...current, platforms: undefined }))
  }

  const runGeneration = () => {
    if (!brief.trim()) return
    setAiNotice(null)
    generate.mutate(
      { brief, platform: aiPlatform, tone, language, media_type: mediaType },
      {
        onSuccess: (draft) => {
          setTitle(draft.title)
          setBody([draft.body, draft.hashtags.join(' ')].filter(Boolean).join('\n\n'))
          if (aiPlatform !== 'both') setPlatforms([aiPlatform])
          setAiGenerated(true)
          setMode('manual')
          setAiNotice(t('post.aiDone'))
        },
        onError: (error) => {
          const code = error instanceof ApiError ? error.code : undefined
          setAiNotice(code === 'ai_not_configured' ? t('post.aiNotConfigured') : t('post.aiFailed'))
        },
      },
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found: Errors = {}
    if (!title.trim()) found.title = t('contactForm.required')
    if (!platforms.length) found.platforms = t('post.platformsRequired')
    if (status === 'scheduled' && !date) found.scheduled_at = t('post.scheduleRequired')
    setErrors(found)
    if (Object.keys(found).length) {
      setMode('manual')
      return
    }

    const data = new FormData()
    data.append('title', title.trim())
    data.append('body', body)
    platforms.forEach((platform) => data.append('platforms', platform))
    data.append('media_type', mediaType)
    data.append('status', status)
    data.append('scheduled_at', date ? combineDateTime(date, time) : '')
    data.append('ai_generated', String(aiGenerated))
    if (file && mediaType !== 'text') data.append('media', file)
    if (removeMedia && !file) data.append('remove_media', 'true')

    save.mutate(data, {
      onSuccess: () => {
        toast.success(post ? t('post.updated') : t('post.created'))
        onClose()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 400) setErrors(error.fieldErrors())
        else toast.error(errorMessage(error))
      },
    })
  }

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(body)
      toast.success(t('post.copied'))
    } catch {
      toast.error(t('common.errorGeneric'))
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal__body stack">
        <SegmentedControl<'manual' | 'ai'>
          label={t('post.createTitle')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'manual', label: t('post.modeManual'), icon: <PenLine aria-hidden /> },
            { value: 'ai', label: t('post.modeAi'), icon: <Sparkles aria-hidden /> },
          ]}
        />

        {aiNotice && (
          <div className={`banner ${generate.isError ? 'banner--danger' : 'banner--info'}`} role="status">
            <Sparkles aria-hidden />
            <span className="banner__text">{aiNotice}</span>
          </div>
        )}

        {mode === 'ai' ? (
          <div className="ai-panel stack">
            <p className="field__hint">{t('post.aiHint')}</p>
            <Field label={t('post.aiBrief')}>
              {(props) => (
                <Textarea {...props} rows={4} autoFocus dir="auto" placeholder={t('post.aiBriefPlaceholder')} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} />
              )}
            </Field>
            <div className="form-grid form-grid--3">
              <Field label={t('post.aiPlatform')}>
                {(props) => (
                  <Select {...props} value={aiPlatform} onChange={(e) => setAiPlatform(e.target.value as typeof aiPlatform)}>
                    <option value="both">{t('platform.both')}</option>
                    <option value="facebook">{t('platform.facebook')}</option>
                    <option value="instagram">{t('platform.instagram')}</option>
                  </Select>
                )}
              </Field>
              <Field label={t('post.aiTone')}>
                {(props) => (
                  <Select {...props} value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
                    <option value="friendly">{t('post.tone.friendly')}</option>
                    <option value="professional">{t('post.tone.professional')}</option>
                    <option value="energetic">{t('post.tone.energetic')}</option>
                  </Select>
                )}
              </Field>
              <Field label={t('post.aiLanguage')}>
                {(props) => (
                  <Select {...props} value={language} onChange={(e) => setLanguage(e.target.value as Locale)}>
                    <option value="fr">{t('language.fr')}</option>
                    <option value="ar">{t('language.ar')}</option>
                    <option value="en">{t('language.en')}</option>
                  </Select>
                )}
              </Field>
            </div>
            <Button variant="primary" icon={<Sparkles aria-hidden />} onClick={runGeneration} loading={generate.isPending} disabled={!brief.trim()}>
              {generate.isPending ? t('post.generating') : aiGenerated ? t('post.regenerate') : t('post.generate')}
            </Button>
          </div>
        ) : (
          <div className="form-grid">
            <Field className="form-grid__full" label={t('post.title')} error={errors.title}>
              {(props) => <Input {...props} dir="auto" placeholder={t('post.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />}
            </Field>
            <Field
              className="form-grid__full"
              label={t('post.body')}
              error={errors.body}
              hint={<span className={body.length > MAX_CHARS ? 'field__error' : undefined}>{t('post.chars', { count: body.length })}</span>}
            >
              {(props) => <Textarea {...props} dir="auto" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}
            </Field>

            <div className="field form-grid__full">
              <span className="field__label">{t('platform.label')}</span>
              <div className="platform-toggles" role="group" aria-label={t('platform.label')}>
                {PLATFORMS.map((platform) => (
                  <button key={platform} type="button" className="filter-chip" aria-pressed={platforms.includes(platform)} onClick={() => togglePlatform(platform)}>
                    <PlatformIcon platform={platform} />
                    {t(`platform.${platform}`)}
                  </button>
                ))}
              </div>
              {errors.platforms && <p className="field__error">{errors.platforms}</p>}
            </div>

            <div className="field form-grid__full">
              <span className="field__label">{t('mediaType.label')}</span>
              <SegmentedControl<MediaType>
                label={t('mediaType.label')}
                value={mediaType}
                onChange={(value) => {
                  setMediaType(value)
                  setFile(null)
                }}
                options={[
                  { value: 'text', label: t('mediaType.text'), icon: <FileText aria-hidden /> },
                  { value: 'image', label: t('mediaType.image'), icon: <ImageIcon aria-hidden /> },
                  { value: 'video', label: t('mediaType.video'), icon: <Film aria-hidden /> },
                ]}
              />
            </div>

            {mediaType !== 'text' && (
              <div className="field form-grid__full">
                <span className="field__label">{t('post.media')}</span>
                <div className="media-picker">
                  {mediaSrc ? (
                    <div className="media-picker__preview">
                      {mediaType === 'image' ? <img src={mediaSrc} alt="" /> : <video src={mediaSrc} controls preload="metadata" />}
                    </div>
                  ) : null}
                  <div className="row row--wrap">
                    <Button size="sm" icon={<Upload aria-hidden />} onClick={() => fileInput.current?.click()}>
                      {mediaSrc ? t('post.replaceFile') : t('post.chooseFile')}
                    </Button>
                    {mediaSrc && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X aria-hidden />}
                        onClick={() => {
                          setFile(null)
                          setRemoveMedia(true)
                        }}
                      >
                        {t('post.removeFile')}
                      </Button>
                    )}
                    {file && <span className="subtle media-picker__name">{file.name}</span>}
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    accept={ACCEPT[mediaType]}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null)
                      setRemoveMedia(false)
                      setErrors((current) => ({ ...current, media: undefined }))
                      e.target.value = ''
                    }}
                  />
                  <p className="field__hint">{t('post.mediaHint')}</p>
                  {errors.media && <p className="field__error">{errors.media}</p>}
                </div>
              </div>
            )}

            <div className="field form-grid__full">
              <span className="field__label">{t('status.label')}</span>
              <SegmentedControl<PostStatus>
                label={t('status.label')}
                value={status}
                onChange={(value) => {
                  setStatus(value)
                  setErrors((current) => ({ ...current, scheduled_at: undefined }))
                }}
                options={[
                  { value: 'draft', label: t('postStatus.draft') },
                  { value: 'scheduled', label: t('postStatus.scheduled') },
                  { value: 'published', label: t('postStatus.published') },
                ]}
              />
            </div>
            <Field label={t('post.date')} error={errors.scheduled_at} optional={status !== 'scheduled'}>
              {(props) => <Input {...props} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label={t('post.time')}>
              {(props) => <Input {...props} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />}
            </Field>
          </div>
        )}
      </div>
      <div className="modal__footer">
        {post && (
          <Button className="modal__footer-start" variant="ghost" iconOnly label={t('common.delete')} icon={<Trash2 aria-hidden />} onClick={() => setConfirmDelete(true)} />
        )}
        {body && mode === 'manual' && (
          <Button variant="ghost" iconOnly label={t('post.copy')} icon={<Copy aria-hidden />} onClick={copyText} className={post ? undefined : 'modal__footer-start'} />
        )}
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </div>

      {post && (
        <ConfirmDialog
          open={confirmDelete}
          title={t('common.confirmDeleteTitle')}
          description={t('post.deleteConfirm', { title: post.title })}
          confirmLabel={t('common.delete')}
          variant="danger"
          loading={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() =>
            remove.mutate(post.id, {
              onSuccess: () => {
                toast.success(t('post.deleted'))
                setConfirmDelete(false)
                onClose()
              },
              onError: (error) => toast.error(errorMessage(error)),
            })
          }
        />
      )}
    </form>
  )
}

function withHour(date: Date, hour: number) {
  const next = new Date(date)
  next.setHours(hour, 0, 0, 0)
  return next
}
