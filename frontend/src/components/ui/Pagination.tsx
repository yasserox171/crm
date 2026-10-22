import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '../../lib/format'
import { Button } from './Button'

interface PaginationProps {
  page: number
  pageSize: number
  count: number
  onPage: (page: number) => void
}

export function Pagination({ page, pageSize, count, onPage }: PaginationProps) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  if (count <= pageSize) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(count, page * pageSize)
  return (
    <nav className="pagination" aria-label={t('common.pageOf', { page, total: totalPages })}>
      <span className="tabular">
        {t('common.rangeOf', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(count) })}
      </span>
      <div className="pagination__buttons">
        <Button
          size="sm"
          icon={<ChevronLeft className="flip-rtl" aria-hidden />}
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          <span className="hide-mobile">{t('common.previous')}</span>
        </Button>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          <span className="hide-mobile">{t('common.next')}</span>
          <ChevronRight className="flip-rtl" aria-hidden />
        </Button>
      </div>
    </nav>
  )
}
