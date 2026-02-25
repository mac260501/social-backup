'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function SiteFooter() {
  const pathname = usePathname() || ''

  if (pathname === '/' || pathname.startsWith('/dashboard/backup/')) {
    return null
  }

  return (
    <footer className="bg-black px-4 py-6 text-xs text-gray-300">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-5">
        <Link href="/privacy" className="underline underline-offset-2 hover:text-white">
          Privacy
        </Link>
        <Link href="/terms" className="underline underline-offset-2 hover:text-white">
          Terms
        </Link>
      </div>
    </footer>
  )
}
