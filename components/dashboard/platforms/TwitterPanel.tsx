import { ExternalLink, FileArchive, Globe } from 'lucide-react'
import {
  formatBackupMethodLabel,
  formatPartialReasonLabel,
  getBackupPartialDetails,
  isArchiveBackup,
} from '@/lib/platforms/backup'
import { useState, type ChangeEvent } from 'react'

export type TwitterScrapeTargets = {
  profile: boolean
  tweets: boolean
  replies: boolean
  followers: boolean
  following: boolean
}

export type DashboardBackupItem = {
  id: string
  backup_type?: string | null
  source?: string | null
  backup_name?: string | null
  backup_source?: string | null
  uploaded_at?: string | null
  created_at?: string | null
  file_size?: number | null
  stats?: {
    tweets?: number
    followers?: number
    following?: number
    likes?: number
    dms?: number
    media_files?: number
  } | null
  data?: {
    profile?: {
      username?: string
    }
    uploaded_file_size?: number
    storage?: {
      payload_bytes?: number | string
      total_bytes?: number | string
    }
    stats?: {
      storage_total_bytes?: number | string
    }
    scrape?: {
      is_partial?: boolean | string | number | null
      partial_reason?: string | null
      partial_reasons?: unknown
      timeline_limit_hit?: boolean | string | number | null
      social_graph_limit_hit?: boolean | string | number | null
    } | null
  } | null
}

export type BackupJobItem = {
  id: string
  job_type: 'archive_upload' | 'snapshot_scrape'
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  message?: string | null
  payload?: Record<string, unknown> | null
  result_backup_id?: string | null
  error_message?: string | null
  started_at?: string | null
  created_at?: string
  updated_at?: string
}

export type UploadResult = {
  success: boolean
  message?: string
  error?: string
}

export type ScrapeResult = {
  success: boolean
  message?: string
  error?: string
}

type ApiUsageSummary = {
  monthStartIso?: string
  spentUsd?: number
  limitUsd?: number
  remainingUsd?: number
}

type TwitterPanelProps = {
  backupsCount: number
  loadingBackups: boolean
  recentBackups: DashboardBackupItem[]
  jobs: BackupJobItem[]
  activeJob: BackupJobItem | null
  uploading: boolean
  uploadProgressPercent: number
  uploadProgressDetail: string | null
  uploadResult: UploadResult | null
  scraping: boolean
  scrapeResult: ScrapeResult | null
  twitterUsername: string
  setTwitterUsername: (value: string) => void
  scrapeTargets: TwitterScrapeTargets
  setScrapeTargets: (value: TwitterScrapeTargets) => void
  apiUsage: ApiUsageSummary | null
  onCancelJob: (jobId: string) => Promise<void>
  onViewBackups: () => void
  onOpenBackup: (backupId: string) => void
  onDownloadBackup: (backupId: string) => Promise<void>
  onDeleteBackup: (backupId: string, label: string) => Promise<void>
  onUploadChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  onScrapeNow: (targets: TwitterScrapeTargets) => Promise<void>
}

export function TwitterPanel({
  backupsCount,
  loadingBackups,
  recentBackups,
  jobs,
  activeJob,
  uploading,
  uploadProgressPercent,
  uploadProgressDetail,
  uploadResult,
  scraping,
  scrapeResult,
  twitterUsername,
  setTwitterUsername,
  scrapeTargets,
  setScrapeTargets,
  apiUsage,
  onCancelJob,
  onViewBackups,
  onOpenBackup,
  onDownloadBackup,
  onDeleteBackup,
  onUploadChange,
  onScrapeNow,
}: TwitterPanelProps) {
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const formatUsd = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return '$0.00'
    return `$${value.toFixed(2)}`
  }
  const toRecord = (value: unknown) => {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  }
  const formatCount = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value).toLocaleString()
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed).toLocaleString()
    }
    return '0'
  }
  const selectedTargetCount = Object.values(scrapeTargets).filter(Boolean).length
  const hasSelectedTargets = selectedTargetCount > 0
  const hasActiveJob = Boolean(activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing'))
  const inProgressJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'processing')
  const activeProgress = Math.max(0, Math.min(100, Number(activeJob?.progress) || 0))
  const activePayload = toRecord(activeJob?.payload)
  const activeLiveMetrics = toRecord(activePayload.live_metrics)
  const activeIsArchiveJob = activeJob?.job_type === 'archive_upload'
  const activeLifecycleState = typeof activePayload.lifecycle_state === 'string' ? activePayload.lifecycle_state : ''
  const activeIsCleaning = activeLifecycleState === 'cleanup' || activeLifecycleState === 'cancelling'
  const activeIsCancelling = activeJob ? cancellingJobId === activeJob.id : false
  const activeStartedLabel = (() => {
    const source = activeJob?.started_at || activeJob?.created_at
    if (!source) return null
    const date = new Date(source)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  })()
  const estimatePayloadBytes = (value: unknown) => {
    try {
      if (!value || typeof value !== 'object') return 0
      return new TextEncoder().encode(JSON.stringify(value)).length
    } catch {
      return 0
    }
  }
  const parseSizeValue = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    return 0
  }
  const resolveBackupSize = (backup: DashboardBackupItem) => {
    const candidates: unknown[] = [
      backup.file_size,
      backup.data?.storage?.total_bytes,
      backup.data?.storage?.payload_bytes,
      backup.data?.stats?.storage_total_bytes,
      backup.data?.uploaded_file_size,
    ]
    for (const value of candidates) {
      const parsed = parseSizeValue(value)
      if (parsed > 0) return parsed
    }
    const payloadEstimate = estimatePayloadBytes(backup.data)
    if (payloadEstimate > 0) return payloadEstimate
    return 0
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-10">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">X (Twitter) Backup</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">Choose one: upload your full archive or take a current snapshot.</p>
            </div>
            <button
              onClick={onViewBackups}
              className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] sm:w-auto"
            >
              View Backups ({backupsCount})
            </button>
          </div>
        </section>

      {hasActiveJob && activeJob && (
        <section className="rounded-3xl border border-blue-300/40 bg-blue-50 p-5 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                Backup job in progress
              </p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-100">
                {activeJob.message || 'Your backup job is running.'}
              </p>
              {activeStartedLabel && (
                <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-200/80">Started {activeStartedLabel}</p>
              )}
            </div>
            <button
              onClick={async () => {
                setCancellingJobId(activeJob.id)
                try {
                  await onCancelJob(activeJob.id)
                } catch (error) {
                  console.error('Cancel job error:', error)
                  alert(error instanceof Error ? error.message : 'Failed to cancel job.')
                } finally {
                  setCancellingJobId(null)
                }
              }}
              disabled={activeIsCancelling || activeIsCleaning}
              className="w-full rounded-full border border-red-500/50 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-1"
            >
              {activeIsCancelling ? 'Cancelling...' : activeIsCleaning ? 'Cleaning...' : 'Cancel'}
            </button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-cyan-300 transition-all"
              style={{ width: `${activeProgress}%` }}
            />
          </div>
          {!activeIsArchiveJob && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-blue-700 dark:text-blue-200 sm:grid-cols-3">
              <p>Tweets: {formatCount(activeLiveMetrics.tweets_fetched)}</p>
              <p>Replies: {formatCount(activeLiveMetrics.replies_fetched)}</p>
              <p>Followers: {formatCount(activeLiveMetrics.followers_fetched)}</p>
              <p>Following: {formatCount(activeLiveMetrics.following_fetched)}</p>
              <p>Tokens Used: {formatUsd(Number(activeLiveMetrics.api_cost_usd || 0))}</p>
              <p>Phase: {typeof activeLiveMetrics.phase === 'string' ? activeLiveMetrics.phase : 'running'}</p>
            </div>
          )}
          <p className="mt-2 text-xs text-blue-700/80 dark:text-blue-200/80">
            You can leave this page and continue tracking this job in All Backups.
          </p>
        </section>
      )}

      <section className="grid gap-7 xl:grid-cols-2">
        <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-7">
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">Upload Archive</h4>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Best for complete history backup.</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Limits: 1GB max archive file, 5GB total account storage.</p>

          <div className="mt-5 space-y-3">
            <details className="group rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/5">
              <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-white">
                <span className="inline-flex items-center gap-2">
                  <span className="transition group-open:rotate-90">›</span>
                  How to get your archive
                </span>
              </summary>
              <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Open X account data settings.</li>
                  <li>Request your archive.</li>
                  <li>Download the ZIP when it is ready.</li>
                </ol>
                <a
                  href="https://twitter.com/settings/download_your_data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Go to X archive page
                </a>
              </div>
            </details>

            <details className="group rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/5">
              <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-white">
                <span className="inline-flex items-center gap-2">
                  <span className="transition group-open:rotate-90">›</span>
                  What is included / not included
                </span>
              </summary>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                  <p className="font-medium text-gray-900 dark:text-white">Included</p>
                  <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                    <li>✓ Full tweet history</li>
                    <li>✓ Media files</li>
                    <li>✓ Followers & following</li>
                    <li>✓ Likes & DMs</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                  <p className="font-medium text-gray-900 dark:text-white">Not included</p>
                  <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                    <li>✗ New activity after archive date</li>
                  </ul>
                </div>
              </div>
            </details>
          </div>

          <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center dark:border-white/20">
            <input
              type="file"
              accept=".zip"
              onChange={onUploadChange}
              disabled={uploading || hasActiveJob}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className={`inline-block w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] sm:w-auto ${(uploading || hasActiveJob) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {uploading ? 'Uploading...' : hasActiveJob ? 'Job in progress...' : 'Choose ZIP File'}
            </label>
          </div>

          {uploading && (
            <div className="mt-4 rounded-xl border border-blue-300/30 bg-blue-500/10 p-3">
              <div className="flex items-center justify-between text-xs text-blue-100/85">
                <span>{uploadProgressDetail || 'Uploading archive...'}</span>
                <span>{Math.max(0, Math.min(100, uploadProgressPercent))}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-400 to-cyan-300 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, uploadProgressPercent))}%` }}
                />
              </div>
            </div>
          )}

          {uploadResult && (
            <p className={`mt-4 text-sm ${uploadResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {uploadResult.success ? uploadResult.message || 'Archive uploaded successfully.' : uploadResult.error || 'Upload failed.'}
            </p>
          )}
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-7">
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">Take Current Snapshot</h4>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Fast backup of your current public profile data.</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Snapshot tokens (month): {formatUsd(apiUsage?.spentUsd)} / {formatUsd(apiUsage?.limitUsd)}. Remaining: {formatUsd(apiUsage?.remainingUsd)}.
          </p>

          <details className="group mt-5 rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/5">
            <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-white">
              <span className="inline-flex items-center gap-2">
                <span className="transition group-open:rotate-90">›</span>
                What is included / not included
              </span>
            </summary>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <p className="font-medium text-gray-900 dark:text-white">Included</p>
                <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                  <li>✓ Profile info</li>
                  <li>✓ Posts / replies (selectable)</li>
                  <li>✓ Followers / following (selectable)</li>
                  <li>✓ Media from fetched posts/replies</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <p className="font-medium text-gray-900 dark:text-white">Not included</p>
                <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                  <li>✗ Likes</li>
                  <li>✗ DMs</li>
                  <li>✗ Older content outside fetched range</li>
                </ul>
              </div>
            </div>
          </details>

          <div className="mt-5 space-y-3">
            <input
              type="text"
              value={twitterUsername}
              onChange={(e) => setTwitterUsername(e.target.value.replace(/^@/, ''))}
              placeholder="X username"
              disabled={scraping || hasActiveJob}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-white/20 dark:bg-black/40 dark:text-white"
            />
            <div className="rounded-2xl border border-gray-200 p-4 dark:border-white/10">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Choose what to scrape ({selectedTargetCount} selected)
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {([
                  ['profile', 'Profile info'],
                  ['tweets', 'Tweets (posts)'],
                  ['replies', 'Replies'],
                  ['followers', 'Followers'],
                  ['following', 'Following'],
                ] as Array<[keyof TwitterScrapeTargets, string]>).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-white/10">
                    <input
                      type="checkbox"
                      checked={scrapeTargets[key]}
                      disabled={scraping || hasActiveJob}
                      onChange={(e) => setScrapeTargets({ ...scrapeTargets, [key]: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 dark:text-gray-300">{label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Media is collected from selected posts/replies so each media item stays linked to its original post.
              </p>
            </div>
            <button
              onClick={() => onScrapeNow(scrapeTargets)}
              disabled={scraping || hasActiveJob || !twitterUsername.trim() || !hasSelectedTargets}
              className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scraping ? 'Starting snapshot...' : hasActiveJob ? 'Job in progress...' : 'Take Snapshot'}
            </button>
          </div>

          {scrapeResult && (
            <p className={`mt-4 text-sm ${scrapeResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {scrapeResult.success ? scrapeResult.message || 'Scrape completed.' : scrapeResult.error || 'Scrape failed.'}
            </p>
          )}
        </div>
      </section>
      </div>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5 sm:p-7">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">Recent Backups</h4>
            <button
              onClick={onViewBackups}
              className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              View all
            </button>
          </div>

        {loadingBackups ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">Loading backups...</p>
        ) : recentBackups.length === 0 && inProgressJobs.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">No backups yet. Upload an archive or take a snapshot to get started.</p>
        ) : (
          <div className="space-y-3">
            {inProgressJobs.map((job) => {
              const isArchiveJob = job.job_type === 'archive_upload'
              const iconWrapClass = isArchiveJob
                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                : 'bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300'
              const payload = toRecord(job.payload)
              const liveMetrics = toRecord(payload.live_metrics)
              const lifecycleState = typeof payload.lifecycle_state === 'string' ? payload.lifecycle_state : ''
              const isCleaning = lifecycleState === 'cleanup' || lifecycleState === 'cancelling'
              const isCancelling = cancellingJobId === job.id

              return (
                <div
                  key={job.id}
                  className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-500/30 dark:bg-blue-500/10"
                >
                  <div className="flex flex-wrap items-start gap-3 sm:items-center sm:gap-4">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${iconWrapClass}`}>
                      {isArchiveJob ? <FileArchive size={20} /> : <Globe size={20} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.96rem] leading-tight font-semibold text-gray-900 dark:text-white">
                        {isArchiveJob ? 'Archive Backup' : 'Current Snapshot'} in progress
                      </p>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                        {job.message || (job.status === 'queued' ? 'Queued' : 'Processing')}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        setCancellingJobId(job.id)
                        try {
                          await onCancelJob(job.id)
                        } catch (error) {
                          console.error('Cancel job error:', error)
                          alert(error instanceof Error ? error.message : 'Failed to cancel job.')
                        } finally {
                          setCancellingJobId(null)
                        }
                      }}
                      disabled={isCancelling || isCleaning}
                      className="w-full rounded-full border border-red-500/50 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-1"
                    >
                      {isCancelling ? 'Cancelling...' : isCleaning ? 'Cleaning...' : 'Cancel'}
                    </button>
                  </div>
                  {!isArchiveJob && typeof liveMetrics.phase === 'string' && (
                    <p className="mt-2 text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Phase: {liveMetrics.phase}
                    </p>
                  )}
                </div>
              )
            })}

            {recentBackups.map((backup) => {
              const isArchive = isArchiveBackup(backup)
              const methodLabel = formatBackupMethodLabel(backup)
              const dateValue = backup.uploaded_at || backup.created_at
              const formattedDate = dateValue
                ? new Date(dateValue).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Unknown date'
              const rawSize = resolveBackupSize(backup)
              const sizeLabel = rawSize > 0 ? `${(rawSize / (1024 * 1024)).toFixed(1)} MB` : '0.0 MB'
              const iconWrapClass = isArchive
                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                : 'bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300'
              const partial = getBackupPartialDetails(backup)
              const partialTitle = partial.reasons.length > 0
                ? partial.reasons.map((reason) => formatPartialReasonLabel(reason)).join(' • ')
                : 'This snapshot did not complete all requested data.'

              return (
                <div
                  key={backup.id}
                  className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 transition hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                >
                  <button
                    onClick={() => onOpenBackup(backup.id)}
                    className="flex w-full min-w-0 items-center gap-3 text-left"
                  >
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${iconWrapClass}`}>
                      {isArchive ? <FileArchive size={20} /> : <Globe size={20} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[0.95rem] leading-tight font-semibold text-gray-900 dark:text-white">{methodLabel}</p>
                        {partial.isPartial && (
                          <span
                            title={partialTitle}
                            className="inline-flex shrink-0 items-center rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                          >
                            Partial
                          </span>
                        )}
                      </div>
                      <p className="text-[0.88rem] text-gray-600 dark:text-gray-300">{formattedDate}</p>
                    </div>
                  </button>

                  <div className="mt-3 flex items-center justify-between">
                    <p className="font-mono tabular-nums text-[0.82rem] font-medium leading-none text-gray-700 dark:text-gray-200">{sizeLabel}</p>
                    <span className="text-[0.72rem] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {isArchive ? 'Archive' : 'Snapshot'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <a
                      href={`/dashboard/backup/${backup.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1 rounded-full bg-white px-2 py-2 text-xs font-semibold text-black hover:bg-gray-200 dark:bg-white dark:text-black"
                    >
                      View
                      <ExternalLink size={12} />
                    </a>
                    <button
                      onClick={() => onDownloadBackup(backup.id)}
                      disabled={!isArchive}
                      className="rounded-full border border-gray-300 px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => onDeleteBackup(backup.id, methodLabel)}
                      className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/25"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </section>
      </aside>
    </div>
  )
}
