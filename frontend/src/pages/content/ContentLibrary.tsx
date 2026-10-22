import { FileText, Film, Image as ImageIcon, LayoutGrid, Library, Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLibrary } from '../../api/hooks'
import type { ContentPost, MediaType } from '../../api/types'
import { PostStatusBadge } from '../../components/ui/Badges'
import { EmptyState } from '../../components/ui/EmptyState'
import { Pagination } from '../../components/ui/Pagination'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Spinner } from '../../components/ui/Spinner'
import { formatDateTime } from '../../lib/format'

type Filter = 'all' | MediaType
const PAGE_SIZE = 24

export function ContentLibrary({ onOpenPost }: { onOpenPost: (post: ContentPost) => void }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const { data, isPending } = useLibrary({ media_type: filter === 'all' ? undefined : filter, page })

  return (
    <div className="library">
      <SegmentedControl<Filter>
        label={t('content.filterType')}
        value={filter}
        onChange={(value) => {
          setFilter(value)
          setPage(1)
        }}
        options={[
          { value: 'all', label: t('common.all'), icon: <LayoutGrid aria-hidden /> },
          { value: 'text', label: t('mediaType.text'), icon: <FileText aria-hidden /> },
          { value: 'image', label: t('mediaType.image'), icon: <ImageIcon aria-hidden /> },
          { value: 'video', label: t('mediaType.video'), icon: <Film aria-hidden /> },
        ]}
      />
      {isPending ? (
        <div className="page-loader">
          <Spinner label={t('common.loading')} />
        </div>
      ) : !data?.results.length ? (
        <EmptyState icon={<Library />} title={t('content.libraryEmptyTitle')} text={t('content.libraryEmptyText')} />
      ) : (
        <>
          <ul className="library__grid">
            {data.results.map((post) => (
              <li key={post.id}>
                <LibraryCard post={post} onOpen={() => onOpenPost(post)} />
              </li>
            ))}
          </ul>
          <div className="library__pagination">
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  )
}

function LibraryCard({ post, onOpen }: { post: ContentPost; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button type="button" className="library-card" onClick={onOpen}>
      <div className={`library-card__media library-card__media--${post.media_type}`}>
        {post.media_type === 'image' && post.media_url ? (
          <img src={post.media_url} alt="" loading="lazy" />
        ) : post.media_type === 'video' && post.media_url ? (
          <>
            <video src={post.media_url} muted preload="metadata" />
            <span className="library-card__play" aria-hidden>
              <Play />
            </span>
          </>
        ) : post.media_type === 'text' ? (
          <p className="library-card__excerpt" dir="auto">
            {post.body || post.title}
          </p>
        ) : (
          <span className="library-card__placeholder" aria-hidden>
            {post.media_type === 'video' ? <Film /> : <ImageIcon />}
          </span>
        )}
        <span className="library-card__type">{t(`mediaType.${post.media_type}`)}</span>
      </div>
      <div className="library-card__body">
        <span className="library-card__title" dir="auto">
          {post.title}
        </span>
        <span className="library-card__meta">
          <PostStatusBadge status={post.status} />
          {post.ai_generated && (
            <span className="badge badge--accent" title={t('post.modeAi')}>
              <Sparkles aria-hidden />
              {t('content.aiBadge')}
            </span>
          )}
          <span className="library-card__platforms">
            {post.platforms.map((platform) => (
              <PlatformIcon key={platform} platform={platform} />
            ))}
          </span>
        </span>
        <span className="subtle tabular library-card__date">{post.scheduled_at ? formatDateTime(post.scheduled_at) : t('content.noDate')}</span>
      </div>
    </button>
  )
}
