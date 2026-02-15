import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { SocialLogoRow } from '@/components/social-logos'

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-gray-950 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.24),transparent_50%)] dark:bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.18),transparent_55%)]" />

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
          Social Backup
        </p>

        <SocialLogoRow />

        <h1 className="pb-3 text-5xl font-extrabold leading-[1.16] tracking-tight sm:text-6xl md:text-7xl">
          Backup your{' '}
          <span className="inline-block pb-[0.08em] bg-gradient-to-r from-[#1d9bf0] via-[#d62976] to-[#25F4EE] bg-clip-text text-transparent">
            legacy
          </span>
          .
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-gray-600 dark:text-gray-300 sm:text-xl">
          Preserve your X, Instagram, and TikTok history in one place with secure backups built for the long term.
        </p>

        <div className="mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-8 py-3 text-lg font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] sm:w-auto"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="w-full rounded-full border border-gray-300 bg-white px-8 py-3 text-lg font-semibold text-gray-900 transition hover:bg-gray-100 dark:border-white/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 sm:w-auto"
          >
            Sign Up
          </Link>
        </div>
      </section>
    </main>
  )
}
