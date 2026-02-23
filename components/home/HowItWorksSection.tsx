import { ArrowRight, FileArchive, SlidersHorizontal } from 'lucide-react'

export function HowItWorksSection() {
  return (
    <section className="rounded-3xl border border-gray-200/80 bg-white/80 p-6 shadow-[0_18px_55px_rgba(17,24,39,0.08)] backdrop-blur sm:p-8 dark:border-white/12 dark:bg-[#071125]/70 dark:shadow-[0_18px_55px_rgba(2,8,25,0.45)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-cyan-200/90">
        How It Works
      </p>
      <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl dark:text-white">
        From upload to backup view in three steps.
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-700 sm:text-base dark:text-gray-200">
        You can import a full X archive ZIP for long-term history, or run a snapshot for current public data. Both
        routes land in the same backup library.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
            <FileArchive className="h-4 w-4" />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">1. Start a backup</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Upload your X archive ZIP or run a fresh snapshot with your selected targets.
          </p>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">2. Choose what to keep</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Review archive contents, optionally skip DMs, and enable client-side encryption for private data.
          </p>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-200">
            <ArrowRight className="h-4 w-4" />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">3. Open your backup</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Browse posts, media, followers, and metadata from your dashboard whenever you need them.
          </p>
        </article>
      </div>

    </section>
  )
}
