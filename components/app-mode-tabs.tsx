import Link from 'next/link'

type AppMode = 'save' | 'scan'

type AppModeTabsProps = {
  activeMode: AppMode
  saveHref: string
  scanHref: string
  className?: string
}

export function AppModeTabs({ activeMode, saveHref, scanHref, className }: AppModeTabsProps) {
  const wrapperClassName = ['inline-flex rounded-xl border border-neutral-300 bg-white/80 p-1 dark:border-neutral-700 dark:bg-neutral-900/80', className]
    .filter(Boolean)
    .join(' ')

  const tabBaseClassName =
    'rounded-lg px-4 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-neutral-900'

  return (
    <nav className={wrapperClassName} aria-label="Product mode">
      <Link
        href={saveHref}
        aria-current={activeMode === 'save' ? 'page' : undefined}
        className={`${tabBaseClassName} ${
          activeMode === 'save'
            ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
            : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100'
        }`}
      >
        Save
      </Link>
      <Link
        href={scanHref}
        aria-current={activeMode === 'scan' ? 'page' : undefined}
        className={`${tabBaseClassName} ${
          activeMode === 'scan'
            ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
            : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100'
        }`}
      >
        Scan
      </Link>
    </nav>
  )
}
