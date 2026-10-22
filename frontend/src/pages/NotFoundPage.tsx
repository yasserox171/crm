import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonClass } from '../components/ui/buttonClass'
import { EmptyState } from '../components/ui/EmptyState'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="page">
      <EmptyState
        icon={<Compass />}
        title={t('notFound.title')}
        text={t('notFound.text')}
        action={
          <Link to="/contacts" className={buttonClass({ variant: 'primary' })}>
            {t('notFound.home')}
          </Link>
        }
      />
    </div>
  )
}
