export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'focus-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' || (preference === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151c1c' : '#0f6e6a')
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    /* storage unavailable */
  }
  applyTheme(preference)
}

// Follow the OS setting live while the preference is "system".
media.addEventListener('change', () => {
  if (getThemePreference() === 'system') applyTheme('system')
})
