import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import en from './dictionaries/en'
import ru from './dictionaries/ru'
import kz from './dictionaries/kz'

type Language = 'RU' | 'EN' | 'KZ'

const dictionaries = { en, ru, kz } as const

interface I18nContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, fallback?: string) => string
  availableLanguages: Language[]
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'procluster_language'

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return (stored === 'RU' || stored === 'EN' || stored === 'KZ') ? stored : 'RU'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language)
  }, [language])

  const dict = dictionaries[language.toLowerCase() as 'ru' | 'en' | 'kz'] ?? dictionaries.ru

  const t = (key: string, fallback?: string): string => {
    return getNestedValue(dict as Record<string, unknown>, key) ?? fallback ?? key
  }

  const setLanguage = (lang: Language) => setLanguageState(lang)

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, availableLanguages: ['RU', 'EN', 'KZ'] }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider')
  return ctx
}
