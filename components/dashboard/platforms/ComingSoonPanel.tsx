export function ComingSoonPanel({ platform, description }: { platform: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 p-8 text-center dark:border-white/15 dark:bg-white/5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Coming Soon</p>
      <h2 className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">{platform} backups are coming soon</h2>
      <p className="mx-auto mt-3 max-w-2xl text-base text-gray-600 dark:text-gray-300">{description}</p>
    </div>
  )
}
