import { Link2Off, LockKeyhole, ShieldCheck, SlidersHorizontal } from 'lucide-react'

export function PrivacyAndControlSection() {
  return (
    <section className="rounded-3xl border border-gray-200/80 bg-white/80 p-6 shadow-[0_18px_55px_rgba(17,24,39,0.08)] backdrop-blur sm:p-8 dark:border-white/12 dark:bg-[#071125]/70 dark:shadow-[0_18px_55px_rgba(2,8,25,0.45)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-cyan-200/90">
        Privacy and Control
      </p>
      <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl dark:text-white">
        You stay in control. We can&apos;t read your DMs.
      </h3>
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
            <LockKeyhole className="h-4 w-4" />
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
    </section>
  )
}
