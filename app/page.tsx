'use client'

import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { ExternalLink, Moon, Sun } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { AppModeTabs } from '@/components/app-mode-tabs'
import { ScanComingSoonPanel } from '@/components/scan-coming-soon-panel'

type BackupJob = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  message?: string | null
  error_message?: string | null
  result_backup_id?: string | null
  payload?: Record<string, unknown> | null
  started_at?: string | null
  created_at?: string | null
}

type BackupRecord = {
  id: string
}

type BackupsApiResponse = {
  success?: boolean
  error?: string
  jobs?: BackupJob[]
  backups?: BackupRecord[]
}

type StartScrapeResponse = {
  success?: boolean
  error?: string
  job?: { id?: string }
  activeJob?: { id?: string }
}

type ReminderApiResponse = {
  success?: boolean
  sent?: boolean
  error?: string
  message?: string
}

type DownloadSelection = {
  tweets: boolean
  replies: boolean
  media: boolean
  followers: boolean
  following: boolean
}

const POLL_INTERVAL_MS = 2500
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitizeUsername(value: string) {
  return value.trim().replace(/^@+/, '')
}

function normalizeProgress(progress: unknown) {
  const parsed = typeof progress === 'number' ? progress : Number(progress)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function inferPhaseFromStatus(statusMessage: string): string | null {
  const match = statusMessage.match(/\(([^)]+)\)/)
  if (!match || !match[1]) return null
  return match[1].trim().toLowerCase()
}

function readReminderEmail(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const email = typeof record.reminder_email === 'string' ? record.reminder_email.trim().toLowerCase() : ''
  return EMAIL_PATTERN.test(email) ? email : null
}

function estimateEtaSeconds(job: BackupJob, progress: number, statusMessage: string): number | null {
  if (progress < 8 || progress >= 100) return null
  const startedAtMs = parseIsoTimestamp(job.started_at) ?? parseIsoTimestamp(job.created_at)
  if (startedAtMs === null) return null

  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000))
  if (elapsedSeconds < 8) return null

  const ratePerSecond = progress / elapsedSeconds
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return null

  const rawRemainingSeconds = Math.round((100 - progress) / ratePerSecond)
  if (rawRemainingSeconds <= 0 || rawRemainingSeconds > 6 * 60 * 60) return null

  const conservativeFactor =
    progress < 25
      ? 2.2
      : progress < 50
        ? 1.75
        : progress < 75
          ? 1.45
          : 1.2
  const phase = inferPhaseFromStatus(statusMessage)
  const phasePaddingSeconds =
    phase === 'scraping'
      ? 20
      : phase === 'media'
        ? 15
        : phase === 'finalizing'
          ? 8
          : 12

  const conservativeRemainingSeconds = Math.round(rawRemainingSeconds * conservativeFactor + phasePaddingSeconds)
  if (conservativeRemainingSeconds <= 0 || conservativeRemainingSeconds > 6 * 60 * 60) return null
  return conservativeRemainingSeconds
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = seconds % 60
  if (minutes < 60) return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`
}

export default function HomePage() {
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const [backupId, setBackupId] = useState<string | null>(null)
  const [downloadSelection, setDownloadSelection] = useState<DownloadSelection>({
    tweets: true,
    replies: true,
    media: true,
    followers: true,
    following: true,
  })
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareLinkError, setShareLinkError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [isDark, setIsDark] = useState(false)
  const [etaLabel, setEtaLabel] = useState<string | null>(null)
  const [showEmailReminderOption, setShowEmailReminderOption] = useState(false)
  const [reminderEmail, setReminderEmail] = useState('')
  const [reminderEmailError, setReminderEmailError] = useState<string | null>(null)
  const [reminderStatus, setReminderStatus] = useState<'idle' | 'saving' | 'saved' | 'sent' | 'error'>('idle')
  const [keepJobRunningOnClose, setKeepJobRunningOnClose] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const activeMode = searchParams.get('tab') === 'scan' ? 'scan' : 'save'

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggleTheme = () => {
    const nextIsDark = !isDark
    setIsDark(nextIsDark)
    document.documentElement.classList.toggle('dark', nextIsDark)
    window.localStorage.setItem('theme', nextIsDark ? 'dark' : 'light')
  }

  useEffect(() => {
    if (!jobId || phase !== 'running') return

    let cancelled = false

    const tick = async () => {
      try {
        const response = await fetch('/api/backups', { cache: 'no-store' })
        const result = (await response.json()) as BackupsApiResponse
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Failed to load scrape status')
        }

        const jobs = result.jobs || []
        const backups = result.backups || []
        const currentJob = jobs.find((job) => job.id === jobId)
        if (!currentJob) return
        if (cancelled) return

        const reminderEmailOnJob = readReminderEmail(currentJob.payload)
        setKeepJobRunningOnClose((current) => current || Boolean(reminderEmailOnJob))

        const nextProgress = normalizeProgress(currentJob.progress)
        const nextStatusMessage = currentJob.message || 'Scraping in progress...'
        setProgress(nextProgress)
        setStatusMessage(nextStatusMessage)
        const nextEtaSeconds = estimateEtaSeconds(currentJob, nextProgress, nextStatusMessage)
        setEtaLabel(nextEtaSeconds ? formatEta(nextEtaSeconds) : null)
        if (nextEtaSeconds !== null && nextEtaSeconds > 60) {
          setShowEmailReminderOption(true)
        }

        if (currentJob.status === 'failed') {
          const failureMessage = currentJob.error_message || currentJob.message || 'Scrape failed.'
          if (failureMessage.toLowerCase().includes('cancel')) {
            setPhase('idle')
            setJobId(null)
            setProgress(0)
            setStatusMessage('Cancelled.')
            setError(null)
            setEtaLabel(null)
            setShowEmailReminderOption(false)
            setReminderEmailError(null)
            setReminderStatus('idle')
            setKeepJobRunningOnClose(false)
            setCanceling(false)
            return
          }
          setPhase('failed')
          setError(failureMessage)
          setEtaLabel(null)
          setKeepJobRunningOnClose(false)
          setCanceling(false)
          return
        }

        if (currentJob.status === 'completed') {
          const completedBackupId = currentJob.result_backup_id || backups[0]?.id || null
          setPhase('completed')
          setProgress(100)
          setStatusMessage(currentJob.message || 'Backup complete.')
          setEtaLabel(null)
          setKeepJobRunningOnClose(false)
          setCanceling(false)
          if (completedBackupId) {
            setBackupId(completedBackupId)
          }
        }
      } catch (pollError) {
        if (cancelled) return
        setPhase('failed')
        setError(pollError instanceof Error ? pollError.message : 'Failed to load scrape status')
        setEtaLabel(null)
        setKeepJobRunningOnClose(false)
        setCanceling(false)
      }
    }

    void tick()
    const intervalId = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [jobId, phase])

  useEffect(() => {
    if (phase !== 'idle' || jobId) return

    let cancelled = false
    const cancelStaleActiveJob = async () => {
      try {
        const response = await fetch('/api/backups', { cache: 'no-store' })
        const result = (await response.json()) as BackupsApiResponse
        if (!response.ok || !result.success || !result.jobs) return
        const activeJob = result.jobs.find((job) => job.status === 'queued' || job.status === 'processing')
        if (!activeJob || cancelled) return
        if (readReminderEmail(activeJob.payload)) return

        await fetch('/api/backups/jobs/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: activeJob.id }),
        })
      } catch {
        // Best effort only; active job can still be cancelled manually.
      }
    }

    void cancelStaleActiveJob()
    return () => {
      cancelled = true
    }
  }, [jobId, phase])

  useEffect(() => {
    if (!jobId || phase !== 'running' || keepJobRunningOnClose) return

    const cancelActiveJob = () => {
      if (keepJobRunningOnClose) return
      const payload = JSON.stringify({ jobId })
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' })
        navigator.sendBeacon('/api/backups/jobs/cancel', blob)
        return
      }
      void fetch('/api/backups/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      })
    }

    window.addEventListener('pagehide', cancelActiveJob)
    window.addEventListener('beforeunload', cancelActiveJob)
    return () => {
      window.removeEventListener('pagehide', cancelActiveJob)
      window.removeEventListener('beforeunload', cancelActiveJob)
    }
  }, [jobId, phase, keepJobRunningOnClose])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedUsername = sanitizeUsername(username)

    if (!normalizedUsername) {
      setError('Enter a username to continue.')
      return
    }

    if (!Object.values(downloadSelection).some(Boolean)) {
      setError('Select at least one item to download.')
      return
    }

    const targets = {
      profile: downloadSelection.tweets || downloadSelection.replies || downloadSelection.media,
      tweets: downloadSelection.tweets || downloadSelection.media,
      replies: downloadSelection.replies,
      followers: downloadSelection.followers,
      following: downloadSelection.following,
    }

    try {
      setSubmitting(true)
      setError(null)
      setProgress(0)
      setStatusMessage('Starting scrape...')
      setPhase('running')
      setBackupId(null)
      setShareUrl(null)
      setShareLinkError(null)
      setCopyState('idle')
      setEtaLabel(null)
      setShowEmailReminderOption(false)
      setReminderEmail('')
      setReminderEmailError(null)
      setReminderStatus('idle')
      setKeepJobRunningOnClose(false)
      setCanceling(false)

      const response = await fetch('/api/platforms/twitter/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUsername,
          targets,
          includeMedia: downloadSelection.media,
        }),
      })
      const result = (await response.json()) as StartScrapeResponse

      if (!response.ok || !result.success) {
        const activeJobId = result.activeJob?.id
        if (activeJobId) {
          setJobId(activeJobId)
          setStatusMessage('Resuming existing scrape...')
          setPhase('running')
          return
        }
        throw new Error(result.error || 'Failed to start scrape')
      }

      const startedJobId = result.job?.id
      if (!startedJobId) {
        throw new Error('No job ID returned from scrape start')
      }

      setJobId(startedJobId)
      setStatusMessage('Scrape queued...')
      setPhase('running')
      setCanceling(false)
    } catch (submitError) {
      setPhase('failed')
      setError(submitError instanceof Error ? submitError.message : 'Failed to start scrape')
      setEtaLabel(null)
      setCanceling(false)
    } finally {
      setSubmitting(false)
    }
  }

  const viewerUrl = backupId ? `/dashboard/backup/${backupId}` : null

  const loadShareLink = async (targetBackupId: string) => {
    try {
      setShareLinkError(null)
      const response = await fetch('/api/backups/share-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupId: targetBackupId,
        }),
      })
      const result = (await response.json()) as { success?: boolean; shareUrl?: string; error?: string }
      if (!response.ok || !result.success || !result.shareUrl) {
        throw new Error(result.error || 'Unable to create backup link.')
      }
      setShareUrl(result.shareUrl)
    } catch (shareError) {
      setShareLinkError(shareError instanceof Error ? shareError.message : 'Unable to create backup link.')
      setShareUrl(null)
    }
  }

  const handleCopyShareLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setShareLinkError('Clipboard copy failed. Please copy manually.')
    }
  }

  useEffect(() => {
    if (!backupId || phase !== 'completed') return
    void loadShareLink(backupId)
  }, [backupId, phase])

  const handleCopyViaForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleCopyShareLink()
  }

  const handleReminderSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = reminderEmail.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setReminderEmailError('Enter a valid email.')
      return
    }
    if (!jobId) {
      setReminderEmailError('No active job found for this reminder.')
      return
    }

    try {
      setKeepJobRunningOnClose(true)
      setReminderStatus('saving')
      setReminderEmailError(null)
      const response = await fetch('/api/backups/jobs/reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          email: normalizedEmail,
        }),
      })
      const result = (await response.json()) as ReminderApiResponse
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Unable to save reminder.')
      }

      setReminderEmail(normalizedEmail)
      setReminderStatus(result.sent ? 'sent' : 'saved')
    } catch (saveError) {
      setKeepJobRunningOnClose(false)
      setReminderStatus('error')
      setReminderEmailError(saveError instanceof Error ? saveError.message : 'Unable to save reminder.')
    }
  }

  const handleCancelScrape = async () => {
    if (!jobId || canceling) return

    try {
      setCanceling(true)
      setError(null)
      setStatusMessage('Cancelling...')
      const response = await fetch('/api/backups/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to cancel job.')
      }
      setShowEmailReminderOption(false)
      setReminderEmailError(null)
      setReminderStatus('idle')
      setKeepJobRunningOnClose(false)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel job.')
      setCanceling(false)
    }
  }

  return (
    <main className="relative min-h-screen bg-neutral-100 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.18),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.25),transparent_50%)]" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center px-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-[calc(5.5rem+env(safe-area-inset-top))] text-center sm:pb-28 sm:pt-24">
        <button
          type="button"
          onClick={toggleTheme}
          className="fixed right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{isDark ? 'Light' : 'Dark'}</span>
        </button>

        <AppModeTabs activeMode={activeMode} saveHref="/" scanHref="/?tab=scan" className="mb-5 sm:mb-6" />

        {activeMode === 'save' ? (
          <div className="flex w-full flex-col items-center gap-5">
            <Image
              src="/logo.png"
              alt="Social Backup logo"
              width={596}
              height={366}
              priority
              className="h-auto w-40 sm:w-44"
            />

            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-neutral-600 dark:text-neutral-400">
              Social Backup
            </p>

            <h1 className="max-w-4xl text-3xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Back up your X account
            </h1>

            <p className="max-w-3xl text-base text-neutral-600 dark:text-neutral-300 sm:text-2xl">
              Just drop in a username.
            </p>

            <p className="max-w-2xl text-xs text-neutral-500 dark:text-neutral-400 sm:text-sm">
              X-style viewer, private link valid for 30 days, and tweets, replies, media, followers, and following included.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 flex w-full max-w-md flex-row items-stretch gap-2">
              <label htmlFor="username" className="sr-only">
                X username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="@username"
                autoComplete="off"
                style={{
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                }}
                className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-blue-400"
              />
              <button
                type="submit"
                disabled={submitting}
                className="shrink-0 whitespace-nowrap rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {submitting ? 'Starting...' : 'Get Backup'}
              </button>
            </form>

            <div className="mb-6 flex flex-col items-center gap-1">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">No sign up required.</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Want to keep it?{' '}
                <a href="/signup" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                  Create a free account.
                </a>
              </p>
            </div>

            <details className="mt-6 inline-block w-fit rounded-xl border border-neutral-300/80 bg-white/60 px-3 py-2 text-left text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300">
              <summary className="cursor-pointer select-none font-semibold">Customize download</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                {(
                  [
                    ['tweets', 'Tweets'],
                    ['replies', 'Replies'],
                    ['media', 'Media'],
                    ['followers', 'Followers'],
                    ['following', 'Following'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={downloadSelection[key]}
                      onChange={(event) =>
                        setDownloadSelection((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </details>

            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Current limits for free users: up to 5,000 tweets + replies combined and 50,000 followers + following combined.
            </p>

            {phase === 'running' && (
              <div className="mt-3 w-full max-w-2xl rounded-2xl border border-neutral-300 bg-white/80 p-4 text-left dark:border-neutral-700 dark:bg-neutral-900/80">
                <div className="mb-2 flex items-center justify-between text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  <span>{statusMessage || 'Scraping in progress...'}</span>
                  <span>{progress}%</span>
                </div>
                <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {etaLabel ? `Estimated time remaining: ~${etaLabel}` : 'Estimated time remaining: calculating...'}
                </p>
                <div className="h-2.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div
                    className="h-2.5 rounded-full bg-blue-600 transition-all duration-500 dark:bg-blue-500"
                    style={{ width: `${Math.max(4, progress)}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCancelScrape()}
                    disabled={canceling}
                    className="text-xs font-medium text-neutral-500 transition hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-200"
                  >
                    {canceling ? 'Cancelling...' : 'Cancel scrape'}
                  </button>
                </div>

                {showEmailReminderOption && (
                  <form onSubmit={handleReminderSubmit} className="mt-3 flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">
                      Hmm, seems to be taking longer than usual, possibly due to the size of the account. Would you like us to email you the link when it&apos;s done?
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="email"
                        value={reminderEmail}
                        onChange={(event) => {
                          setReminderEmail(event.target.value)
                          if (reminderStatus !== 'idle') {
                            setReminderStatus('idle')
                          }
                        }}
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-blue-600 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-blue-400"
                      />
                      <button
                        type="submit"
                        disabled={reminderStatus === 'saving' || reminderStatus === 'saved' || reminderStatus === 'sent'}
                        className="whitespace-nowrap rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-300"
                      >
                        {reminderStatus === 'sent' ? 'Email sent' : reminderStatus === 'saved' ? 'Saved' : reminderStatus === 'saving' ? 'Saving...' : 'Notify me'}
                      </button>
                    </div>
                    {(reminderStatus === 'saved' || reminderStatus === 'sent') && (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {reminderStatus === 'sent'
                          ? 'Backup was already ready. Email sent.'
                          : 'Saved. We&apos;ll send the link once the backup is ready.'}
                      </p>
                    )}
                    {reminderEmailError && (
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">{reminderEmailError}</p>
                    )}
                  </form>
                )}
              </div>
            )}

            {error && (
              <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            {phase === 'completed' && viewerUrl && (
              <div className="mt-3 flex w-full max-w-md flex-col items-center gap-2">
                <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Backup is ready.</p>
                <a
                  href={viewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-300"
                >
                  <span>Open Backup</span>
                  <ExternalLink className="h-4 w-4" />
                </a>

                <form onSubmit={handleCopyViaForm} className="mt-3 flex w-full flex-col gap-2">
                  <p className="text-center text-xs text-neutral-600 dark:text-neutral-400">Link is valid for 30 days.</p>
                  <button
                    type="submit"
                    disabled={!shareUrl}
                    title={shareUrl || 'Generating link...'}
                    className="w-full truncate rounded-xl border border-neutral-300 bg-white px-3 py-2 text-left text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {copyState === 'copied' ? 'Copied to clipboard' : shareUrl || 'Generating backup link...'}
                  </button>
                  {shareLinkError && (
                    <p className="text-center text-xs font-medium text-red-600 dark:text-red-400">{shareLinkError}</p>
                  )}
                </form>

                <p className="mt-1 text-center text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Or{' '}
                  <a href="/signup" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
                    sign up
                  </a>{' '}
                  and you can access it here anytime, with more backup features.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-5">
            <Image
              src="/logo.png"
              alt="Social Backup logo"
              width={596}
              height={366}
              priority
              className="h-auto w-40 sm:w-44"
            />
            <ScanComingSoonPanel className="mt-1" />
          </div>
        )}
      </section>

      <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-20 rounded-full border border-neutral-300 bg-white/85 px-3.5 py-1.5 text-sm font-medium text-neutral-700 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-300">
        <a href="/login" className="transition hover:text-neutral-900 dark:hover:text-neutral-100">
          Sign in
        </a>
        <span className="mx-1.5 text-neutral-400 dark:text-neutral-600">/</span>
        <a href="/signup" className="transition hover:text-neutral-900 dark:hover:text-neutral-100">
          Sign up
        </a>
      </div>
    </main>
  )
}
