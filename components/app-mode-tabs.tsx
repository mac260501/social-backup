import Link from 'next/link'

type AppMode = 'save' | 'scan'

type AppModeTabsProps = {
  activeMode: AppMode
  saveHref: string
  scanHref: string
  className?: string
}

export function AppModeTabs({ activeMode, saveHref, scanHref, className }: AppModeTabsProps) {
  const wrapperClassName = [
    'inline-flex rounded-2xl border border-neutral-300/90 bg-white/90 p-1.5 shadow-[0_4px_16px_rgba(15,23,42,0.08)] dark:border-neutral-600/70 dark:bg-neutral-900/85',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const tabBaseClassName =
    'min-w-[6rem] rounded-xl px-5 py-2 text-[15px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-neutral-900'

  return (
    <nav className={wrapperClassName} aria-label="Product mode">
      <Link
        href={saveHref}
        aria-current={activeMode === 'save' ? 'page' : undefined}
        className={`${tabBaseClassName} ${
          activeMode === 'save'
            ? 'bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900'
            : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
        }`}
      >
        Save
      </Link>
      <Link
        href={scanHref}
        aria-current={activeMode === 'scan' ? 'page' : undefined}
        className={`${tabBaseClassName} ${
          activeMode === 'scan'
            ? 'bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900'
            : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
        }`}
      >
        Scan
      </Link>
    </nav>
  )
}
