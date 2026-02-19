import { FileArchive, Globe } from 'lucide-react'
import { formatBackupMethodLabel, isArchiveBackup } from '@/lib/platforms/backup'
import type { ChangeEvent } from 'react'

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
  } | null
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

type TwitterPanelProps = {
  backupsCount: number
  loadingBackups: boolean
  recentBackups: DashboardBackupItem[]
  uploading: boolean
  uploadResult: UploadResult | null
  scraping: boolean
  scrapeResult: ScrapeResult | null
  twitterUsername: string
  setTwitterUsername: (value: string) => void
  scrapeTargets: TwitterScrapeTargets
  setScrapeTargets: (value: TwitterScrapeTargets) => void
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
  uploading,
  uploadResult,
  scraping,
  scrapeResult,
  twitterUsername,
  setTwitterUsername,
  scrapeTargets,
  setScrapeTargets,
  onViewBackups,
  onOpenBackup,
  onDownloadBackup,
  onDeleteBackup,
  onUploadChange,
  onScrapeNow,
}: TwitterPanelProps) {
  const selectedTargetCount = Object.values(scrapeTargets).filter(Boolean).length
  const hasSelectedTargets = selectedTargetCount > 0

  return (
    <div className="space-y-10">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">X (Twitter) Backup</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">Choose one: upload your full archive or take a current snapshot.</p>
          </div>
          <button
            onClick={onViewBackups}
            className="rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1]"
          >
            View Backups ({backupsCount})
          </button>
        </div>
      </section>

      <section className="grid gap-7 xl:grid-cols-2">
        <div className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">Upload Archive</h4>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Best for complete history backup.</p>

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
              disabled={uploading}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className={`inline-block rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {uploading ? 'Processing...' : 'Choose ZIP File'}
            </label>
          </div>

          {uploadResult && (
            <p className={`mt-4 text-sm ${uploadResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {uploadResult.success ? uploadResult.message || 'Archive uploaded successfully.' : uploadResult.error || 'Upload failed.'}
            </p>
          )}
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
          <h4 className="text-base font-semibold text-gray-900 dark:text-white">Take Current Snapshot</h4>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Fast backup of your current public profile data.</p>

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
              disabled={scraping}
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
                      disabled={scraping}
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
              disabled={scraping || !twitterUsername.trim() || !hasSelectedTargets}
              className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scraping ? 'Creating snapshot...' : 'Take Snapshot'}
            </button>
          </div>

          {scrapeResult && (
            <p className={`mt-4 text-sm ${scrapeResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {scrapeResult.success ? scrapeResult.message || 'Scrape completed.' : scrapeResult.error || 'Scrape failed.'}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
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
        ) : recentBackups.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">No backups yet. Upload an archive or take a snapshot to get started.</p>
        ) : (
          <div className="space-y-3">
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
              const rawSize = backup.file_size || backup.data?.uploaded_file_size || 0
              const sizeLabel = rawSize > 0 ? `${(rawSize / (1024 * 1024)).toFixed(1)} MB` : 'Snapshot'
              const iconWrapClass = isArchive
                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                : 'bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300'

              return (
                <div
                  key={backup.id}
                  className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 transition hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div
                    className="flex min-w-0 cursor-pointer items-center gap-4"
                    onClick={() => onOpenBackup(backup.id)}
                  >
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${iconWrapClass}`}>
                      {isArchive ? <FileArchive size={20} /> : <Globe size={20} />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[0.96rem] leading-tight font-semibold text-gray-900 dark:text-white">{methodLabel}</p>
                      <p className="text-[0.9rem] text-gray-600 dark:text-gray-300">{formattedDate}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="mr-2 text-right">
                      <p className="font-mono tabular-nums text-[0.9rem] font-medium leading-none text-gray-700 dark:text-gray-200">{sizeLabel}</p>
                    </div>
                    <button
                      onClick={() => onOpenBackup(backup.id)}
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-200 dark:bg-white dark:text-black"
                    >
                      View
                    </button>
                    <button
                      onClick={() => onDownloadBackup(backup.id)}
                      disabled={!isArchive}
                      className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => onDeleteBackup(backup.id, methodLabel)}
                      className="rounded-full border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/25"
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
    </div>
  )
}
