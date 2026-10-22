import { CalendarDays, Library, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentPost } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { ContentLibrary } from './ContentLibrary'
import { MonthCalendar } from './MonthCalendar'
import { PostEditorModal } from './PostEditorModal'

type Tab = 'calendar' | 'library'

export default function ContentPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('calendar')
  const [editor, setEditor] = useState<{ open: boolean; post?: ContentPost; date?: Date }>({ open: false })

  const openPost = (post: ContentPost) => setEditor({ open: true, post })
  const create = (date?: Date) => setEditor({ open: true, date })

  return (
    <div className="page">
      <header className="page__header page__header--hide-title-mobile">
        <div className="page__heading">
          <h1 className="page__title">{t('content.title')}</h1>
          <p className="page__subtitle">{t('content.subtitle')}</p>
        </div>
        <div className="page__actions">
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => create()}>
            {t('content.create')}
          </Button>
        </div>
      </header>

      <div className="content-tabs">
        <SegmentedControl<Tab>
          label={t('content.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'calendar', label: t('content.tabCalendar'), icon: <CalendarDays aria-hidden /> },
            { value: 'library', label: t('content.tabLibrary'), icon: <Library aria-hidden /> },
          ]}
        />
      </div>

      <section className="card content-card">
        {tab === 'calendar' ? <MonthCalendar onOpenPost={openPost} onCreate={create} /> : <ContentLibrary onOpenPost={openPost} />}
      </section>

      <PostEditorModal
        open={editor.open}
        post={editor.post}
        defaultDate={editor.date}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
