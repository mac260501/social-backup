import Image from 'next/image'
import Link from 'next/link'
import { ChevronDown, KeyRound, Link2Off, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { SocialLogoRow } from '@/components/social-logos'

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-gray-950 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.24),transparent_50%)] dark:bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.18),transparent_55%)]" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 text-center">
        <Image
          src="/logo.png"
          alt="Social Backup logo"
          width={596}
          height={366}
          priority
          className="mb-4 h-auto w-44 sm:w-52 md:w-60"
        />

        <div className="mb-6 inline-flex items-center gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
            Social Backup
          </p>
          <span className="rounded-full border border-[#1d9bf0]/35 bg-[#1d9bf0]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1d9bf0] dark:border-[#25F4EE]/40 dark:bg-[#25F4EE]/10 dark:text-[#25F4EE]">
            Beta
          </span>
        </div>

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

        <div className="mt-5 inline-flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/80 bg-white/70 px-3 py-2 text-xs font-semibold text-gray-700 backdrop-blur dark:border-white/15 dark:bg-white/5 dark:text-gray-200">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-white/10">No social account linking</span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-white/10">Client-side DM encryption</span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-white/10">Optional encrypted ZIP storage</span>
        </div>

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

        <a
          href="#learn-more"
          className="group mt-12 inline-flex flex-col items-center gap-1 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
          aria-label="Learn more"
        >
          <span>Learn more</span>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300/80 bg-white/70 text-gray-600 transition group-hover:border-gray-400 group-hover:text-gray-900 motion-safe:animate-bounce dark:border-white/20 dark:bg-white/5 dark:text-gray-200 dark:group-hover:border-white/40 dark:group-hover:text-white">
            <ChevronDown className="h-4 w-4" />
          </span>
        </a>
      </section>

      <section id="learn-more" className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="rounded-3xl border border-gray-200/80 bg-white/80 p-6 shadow-[0_18px_55px_rgba(17,24,39,0.08)] backdrop-blur sm:p-8 dark:border-white/12 dark:bg-[#071125]/70 dark:shadow-[0_18px_55px_rgba(2,8,25,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-cyan-200/90">
            Privacy and Control
          </p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl dark:text-white">
            You stay in control. We can&apos;t read your DMs.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-700 sm:text-base dark:text-gray-200">
            Choose exactly what you import, including Skip DMs. When DM encryption is enabled, passphrases and recovery
            keys stay in your browser. If you choose to store your original archive, it is encrypted client-side before
            upload.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <article className="rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">Full control over imports</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Pick what to include before processing. Nothing is imported blindly.
              </p>
            </article>

            <article className="rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">No social account access</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                We do not link to your social media accounts. Backups are handled separately from account logins.
              </p>
            </article>

            <article className="rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-200">
                <KeyRound className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">Client-side encryption</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                DMs are encrypted in your browser. Optional archive storage encryption is also done client-side.
              </p>
            </article>
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-300/70 bg-emerald-50 px-4 py-3 dark:border-emerald-400/40 dark:bg-emerald-500/10">
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
              Can you read my DMs? No.
            </p>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-100/90">
              Only you can decrypt them with your passphrase or recovery key.
            </p>
          </div>

          <details className="group mt-4 rounded-2xl border border-gray-200 bg-white/70 p-4 dark:border-white/12 dark:bg-white/5">
            <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900 dark:text-white">
              <span className="inline-flex items-center gap-2">
                <Link2Off className="h-4 w-4" />
                Technical details (optional)
              </span>
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Encryption and key derivation run in your browser. We never receive your DM passphrase or recovery key.
            </p>
          </details>
        </div>
      </section>
    </main>
  )
}
