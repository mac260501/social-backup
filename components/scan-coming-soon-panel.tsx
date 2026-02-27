type ScanComingSoonPanelProps = {
  className?: string
}

export function ScanComingSoonPanel({ className }: ScanComingSoonPanelProps) {
  const panelClassName = ['mx-auto w-full max-w-3xl text-center', className].filter(Boolean).join(' ')

  return (
    <section className={panelClassName}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">Coming soon</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-4xl">Tweet + Profile Scanner</h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-600 dark:text-neutral-300 sm:text-base">
        Scan mode will help prevent suspensions with tweet checks before posting, profile health scanning, and ongoing monitoring alerts.
      </p>

      <div className="mt-6 rounded-2xl border border-neutral-300 bg-white/85 p-4 text-left dark:border-neutral-700 dark:bg-neutral-900/80">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">Planned tools</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white/90 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">Tweet scanner</p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Checks draft tweets for high-risk phrasing before you post.</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white/90 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">Profile scanner</p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Tracks profile changes and flags unusual updates that can trigger reviews.</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white/90 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">Monitoring</p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Continuous checks with alerts so you can respond before issues escalate.</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-neutral-300 bg-white/85 p-4 text-left dark:border-neutral-700 dark:bg-neutral-900/80">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">@youraccount</p>
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
            Risk low
          </span>
        </div>
        <div className="mt-3 space-y-2">
          <div className="rounded-xl border border-neutral-200 bg-white/90 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">Tweet scan preview</p>
            <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-100">Draft checked. One phrase marked for safer wording.</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white/90 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">Profile scan preview</p>
            <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-100">Bio, avatar, and username look stable. No impersonation flags.</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white/90 p-3 dark:border-neutral-700 dark:bg-neutral-950/60">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">Monitoring preview</p>
            <p className="mt-1 text-sm text-neutral-900 dark:text-neutral-100">Daily checks active. Alert queue is clear.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
