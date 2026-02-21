import Link from 'next/link'

type DashboardBannerProps = {
  status: 'pending' | 'pending_extended'
  archiveRequestedAt: string | null
}

function formatRequestedAt(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function DashboardBanner({ status, archiveRequestedAt }: DashboardBannerProps) {
  const requestedAtLabel = formatRequestedAt(archiveRequestedAt)
  const waitingLabel =
    status === 'pending_extended'
      ? 'Twitter may still be preparing it. We will send another reminder shortly.'
      : 'Your archive request is in progress. Continue once the ZIP is ready.'

  return (
    <section className="mb-6 rounded-2xl border border-blue-300/35 bg-blue-500/12 p-4 shadow-[0_12px_30px_rgba(3,25,63,0.3)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-100">Your Twitter archive should be ready soon</p>
          <p className="mt-1 text-sm text-blue-100/80">{waitingLabel}</p>
          {requestedAtLabel && <p className="mt-1 text-xs text-blue-100/60">Requested: {requestedAtLabel}</p>}
        </div>
        <Link
          href="/dashboard/archive-wizard?step=2"
          className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-gray-200"
        >
          Download & Upload
        </Link>
      </div>
    </section>
  )
}
