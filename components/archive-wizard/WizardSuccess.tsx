type WizardSuccessProps = {
  stats: {
    tweets: number
    followers: number
    following: number
    likes: number
    dms: number
    mediaFiles: number
  } | null
  backupId: string | null
}

function formatCount(value: number | undefined) {
  if (!Number.isFinite(value)) return '0'
  return Math.max(0, value || 0).toLocaleString()
}

export function WizardSuccess({ stats, backupId }: WizardSuccessProps) {
  return (
    <section className="rounded-3xl border border-emerald-300/35 bg-[#0f1937]/92 p-6 shadow-[0_14px_40px_rgba(4,10,28,0.35)] sm:p-8">
      <h2 className="text-3xl font-bold text-white">Your Twitter data is backed up</h2>
      <p className="mt-3 text-emerald-100/90">Setup is complete. Your archive has been uploaded and processed.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/15 bg-[#0a1430] p-4">
          <p className="text-xs uppercase tracking-wide text-blue-100/65">Tweets</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCount(stats?.tweets)}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-[#0a1430] p-4">
          <p className="text-xs uppercase tracking-wide text-blue-100/65">Likes</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCount(stats?.likes)}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-[#0a1430] p-4">
          <p className="text-xs uppercase tracking-wide text-blue-100/65">Direct Messages</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCount(stats?.dms)}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-[#0a1430] p-4">
          <p className="text-xs uppercase tracking-wide text-blue-100/65">Followers</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCount(stats?.followers)}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-[#0a1430] p-4">
          <p className="text-xs uppercase tracking-wide text-blue-100/65">Following</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCount(stats?.following)}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-[#0a1430] p-4">
          <p className="text-xs uppercase tracking-wide text-blue-100/65">Media Files</p>
          <p className="mt-1 text-xl font-semibold text-white">{formatCount(stats?.mediaFiles)}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href={backupId ? `/dashboard/backup/${backupId}` : '/dashboard?tab=all-backups'}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1]"
        >
          View Your Backup
        </a>
        <a
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-blue-100 hover:bg-white/10"
        >
          Return to Dashboard
        </a>
      </div>
    </section>
  )
}
