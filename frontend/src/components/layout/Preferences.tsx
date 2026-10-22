import { Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateLanguage } from '../../api/hooks'
import { LANGUAGES, type Language } from '../../i18n'
import { getThemePreference, setThemePreference, type ThemePreference } from '../../lib/theme'
import { SegmentedControl } from '../ui/SegmentedControl'

const SHORT_LABELS: Record<Language, string> = { fr: 'FR', ar: 'ع', en: 'EN' }

export function LanguageSwitcher({ persist = true }: { persist?: boolean }) {
  const { t, i18n } = useTranslation()
  const updateLanguage = useUpdateLanguage()
  return (
    <SegmentedControl<Language>
      label={t('prefs.language')}
      value={(LANGUAGES.includes(i18n.language as Language) ? i18n.language : 'fr') as Language}
      onChange={(lng) => {
        i18n.changeLanguage(lng)
        if (persist) updateLanguage.mutate(lng)
      }}
      options={LANGUAGES.map((lng) => ({
        value: lng,
        label: (
          <span lang={lng} title={t(`language.${lng}`)}>
            {SHORT_LABELS[lng]}
          </span>
        ),
      }))}
    />
  )
}

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference)
  return (
    <SegmentedControl<ThemePreference>
      label={t('prefs.theme')}
      value={theme}
      onChange={(value) => {
        setTheme(value)
        setThemePreference(value)
      }}
      options={[
        { value: 'light', label: <span className="sr-only">{t('prefs.themeLight')}</span>, icon: <Sun aria-hidden /> },
        { value: 'dark', label: <span className="sr-only">{t('prefs.themeDark')}</span>, icon: <Moon aria-hidden /> },
        { value: 'system', label: <span className="sr-only">{t('prefs.themeSystem')}</span>, icon: <Monitor aria-hidden /> },
      ]}
    />
  )
}
