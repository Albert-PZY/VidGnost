import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { resources, type AppLocale } from './resources'

const STORAGE_KEY = 'vidgnost-locale'
const DEFAULT_LOCALE: AppLocale = 'zh-CN'
const SUPPORTED_LOCALES = Object.keys(resources) as AppLocale[]

function detectInitialLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved && SUPPORTED_LOCALES.includes(saved as AppLocale)) {
    return saved as AppLocale
  }
  if (window.navigator.language.toLowerCase().startsWith('en')) {
    return 'en'
  }
  return DEFAULT_LOCALE
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (locale) => {
  if (typeof window === 'undefined') return
  if (SUPPORTED_LOCALES.includes(locale as AppLocale)) {
    window.localStorage.setItem(STORAGE_KEY, locale)
  }
})

export { DEFAULT_LOCALE, STORAGE_KEY, SUPPORTED_LOCALES }
export default i18n
