'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

type ThemeContextType = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Initialize from the document class if available (SSR-safe)
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme
      if (stored) return stored

      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      return prefersDark ? 'dark' : 'light'
    }
    return 'light'
  })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Ensure DOM is in sync with state after mount
    const currentTheme = localStorage.getItem('theme') as Theme
    if (currentTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else if (currentTheme === 'light') {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  const toggleTheme = () => {
    console.log('toggleTheme called, current theme:', theme)
    const newTheme = theme === 'light' ? 'dark' : 'light'
    console.log('Setting new theme to:', newTheme)
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)

    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark')
      console.log('Added dark class to document')
    } else {
      document.documentElement.classList.remove('dark')
      console.log('Removed dark class from document')
    }
    console.log('Document classes:', document.documentElement.className)
  }

  if (!mounted) {
    return <>{children}</>
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
