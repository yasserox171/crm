import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { readStorage, writeStorage } from '../lib/storage'
import ar from './locales/ar.json'
import en from './locales/en.json'
import fr from './locales/fr.json'

export const LANGUAGES = ['fr', 'ar', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'focus-lang'

function initialLanguage(): Language {
  const saved = readStorage(STORAGE_KEY)
  return LANGUAGES.includes(saved as Language) ? (saved as Language) : 'fr'
}

function applyDocumentLanguage(lng: string) {
  document.documentElement.lang = lng
  document.documentElement.dir = i18n.dir(lng)
}

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, ar: { translation: ar }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'fr',
  supportedLngs: LANGUAGES,
  interpolation: { escapeValue: false },
  returnNull: false,
})

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', (lng) => {
  applyDocumentLanguage(lng)
  writeStorage(STORAGE_KEY, lng)
})

export function currentLanguage(): Language {
  return (LANGUAGES.includes(i18n.language as Language) ? i18n.language : 'fr') as Language
}

export default i18n
