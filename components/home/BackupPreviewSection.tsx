import { FileArchive, Globe } from 'lucide-react'

export function BackupPreviewSection() {
  return (
    <section className="rounded-3xl border border-gray-200/80 bg-white/80 p-6 shadow-[0_18px_55px_rgba(17,24,39,0.08)] backdrop-blur sm:p-8 dark:border-white/12 dark:bg-[#071125]/70 dark:shadow-[0_18px_55px_rgba(2,8,25,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-300/85">
            Backup Preview
          </p>
          <h3 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">What your backups look like</h3>
        </div>
        <p className="max-w-lg text-sm text-gray-600 dark:text-gray-300">
          Each backup includes a timestamp, size estimate, source method, and a structured view of the imported data.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-4 dark:border-indigo-400/30 dark:from-indigo-500/10 dark:to-white/5">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                <FileArchive className="h-4 w-4" />
              </span>
              <p className="font-semibold text-gray-900 dark:text-white">Archive Backup</p>
            </div>
            <span className="rounded-full border border-indigo-300/70 bg-indigo-100/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:border-indigo-300/40 dark:bg-indigo-400/20 dark:text-indigo-100">
              Full history
            </span>
          </div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Example: Feb 23, 2026 • 842 MB • Source: X archive ZIP
          </p>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            Includes tweets, media, followers, following, likes, and optional encrypted DMs.
          </p>
        </article>

        <article className="rounded-2xl border border-pink-200 bg-gradient-to-b from-pink-50 to-white p-4 dark:border-pink-400/30 dark:from-pink-500/10 dark:to-white/5">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200">
                <Globe className="h-4 w-4" />
              </span>
              <p className="font-semibold text-gray-900 dark:text-white">Snapshot Backup</p>
            </div>
            <span className="rounded-full border border-pink-300/70 bg-pink-100/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pink-700 dark:border-pink-300/40 dark:bg-pink-400/20 dark:text-pink-100">
              Current state
            </span>
          </div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Example: Feb 23, 2026 • 38 MB • Source: live scrape
          </p>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            Includes selected public profile data, posts, replies, followers, following, and linked media.
          </p>
        </article>
      </div>
    </section>
  )
}
