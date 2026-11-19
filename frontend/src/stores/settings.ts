import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Settings {
  appearance: 'light' | 'dark' | 'system'
  language: 'zh' | 'en'
  setAppearance: (value: Settings['appearance']) => void
  setLanguage: (value: Settings['language']) => void
}
export const useSettings = create<Settings>()(persist(set => ({
  appearance: 'system', language: 'zh',
  setAppearance: appearance => set({ appearance }),
  setLanguage: language => set({ language }),
}), { name: 'jarvis-ui-settings' }))

export function useT() {
  const language = useSettings(state => state.language)
  return (zh: string, en: string) => language === 'en' ? en : zh
}
