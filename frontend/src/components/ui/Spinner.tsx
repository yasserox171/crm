import { useTranslation } from 'react-i18next'

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />
}

export function PageLoader() {
  const { t } = useTranslation()
  return (
    <div className="page-loader">
      <Spinner label={t('common.loading')} />
    </div>
  )
}
