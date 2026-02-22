'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ExternalLink, FileArchive, FolderArchive, Globe, LogOut, UserRound } from 'lucide-react'
import { InstagramLogo, TikTokLogo, XLogo } from '@/components/social-logos'
import { createClient } from '@/lib/supabase/client'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { InstagramPanel } from '@/components/dashboard/platforms/InstagramPanel'
import { TikTokPanel } from '@/components/dashboard/platforms/TikTokPanel'
import { DashboardBanner } from '@/components/archive-wizard/DashboardBanner'
import {
  TwitterPanel,
  type BackupJobItem,
  type DashboardBackupItem,
  type ScrapeResult,
  type TwitterScrapeTargets,
  type UploadResult,
} from '@/components/dashboard/platforms/TwitterPanel'
import {
  formatBackupMethodLabel,
  formatPartialReasonLabel,
  getBackupPartialDetails,
  inferBackupPlatform,
  isArchiveBackup,
} from '@/lib/platforms/backup'
import { listPlatformDefinitions } from '@/lib/platforms/registry'
import type { PlatformId } from '@/lib/platforms/types'
import {
  type DirectUploadProgress,
  uploadTwitterArchiveDirect,
} from '@/lib/platforms/twitter/direct-upload'

type DashboardTab = PlatformId | 'all-backups' | 'account'
type AllBackupsFilter = 'all' | PlatformId
type AllBackupsTypeFilter = 'all' | 'archive' | 'snapshot'
type AllBackupsSort = 'newest' | 'oldest' | 'size_desc' | 'size_asc'
type ApiUsageSummary = {
  monthStartIso?: string
  spentUsd?: number
  limitUsd?: number
  remainingUsd?: number
}
type StorageSummary = {
  totalBytes?: number
  limitBytes?: number
  remainingBytes?: number
}
type ArchiveWizardState = 'pending' | 'pending_extended' | 'ready' | 'completed' | 'skipped' | null
type PendingDeleteState = {
  backupIds: string[]
  label: string
}
type ArchiveWizardStatusResponse = {
  success?: boolean
  status?: ArchiveWizardState
  archiveRequestedAt?: string | null
  hasArchiveBackup?: boolean
  schemaReady?: boolean
}
const DEFAULT_TWITTER_SCRAPE_TARGETS: TwitterScrapeTargets = {
  profile: true,
  tweets: true,
  replies: true,
  followers: true,
  following: true,
}

function parseSizeValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function estimatePayloadBytes(value: unknown) {
  try {
    if (!value || typeof value !== 'object') return 0
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

function resolveBackupSize(backup: DashboardBackupItem) {
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

function formatDate(dateString?: string | null) {
  if (!dateString) return 'Unknown date'
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSize(bytes?: number) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return '0.0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatSizeForLimit(bytes?: number) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return '0.0 GB'
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const platforms = useMemo(() => listPlatformDefinitions(), [])

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DashboardTab>('twitter')
  const [allBackupsFilter, setAllBackupsFilter] = useState<AllBackupsFilter>('all')
  const [allBackupsTypeFilter, setAllBackupsTypeFilter] = useState<AllBackupsTypeFilter>('all')
  const [allBackupsSort, setAllBackupsSort] = useState<AllBackupsSort>('newest')

  const [displayName, setDisplayName] = useState('')
  const [twitterUsername, setTwitterUsername] = useState('')

  const [backupsCount, setBackupsCount] = useState<number>(0)
  const [loadingBackups, setLoadingBackups] = useState(true)
  const [backups, setBackups] = useState<DashboardBackupItem[]>([])
  const [allBackups, setAllBackups] = useState<DashboardBackupItem[]>([])
  const [jobs, setJobs] = useState<BackupJobItem[]>([])
  const [apiUsage, setApiUsage] = useState<ApiUsageSummary | null>(null)
  const [reportedTotalStorageBytes, setReportedTotalStorageBytes] = useState<number | null>(null)
  const [reportedStorageLimitBytes, setReportedStorageLimitBytes] = useState<number>(5 * 1024 * 1024 * 1024)
  const [archiveWizardStatus, setArchiveWizardStatus] = useState<ArchiveWizardState>(null)
  const [archiveRequestedAt, setArchiveRequestedAt] = useState<string | null>(null)
  const [archiveSetupMessage, setArchiveSetupMessage] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0)
  const [uploadProgressDetail, setUploadProgressDetail] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)

  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null)
  const [twitterScrapeTargets, setTwitterScrapeTargets] = useState<TwitterScrapeTargets>(DEFAULT_TWITTER_SCRAPE_TARGETS)
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null)
  const [selectedBackupIds, setSelectedBackupIds] = useState<string[]>([])
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingBackup, setDeletingBackup] = useState(false)
  const tabParam = searchParams.get('tab')
  const archiveRequestedParam = searchParams.get('archiveRequested')

  const fetchBackupsSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/backups')
      const result = (await response.json()) as {
        success?: boolean
        backups?: DashboardBackupItem[]
        jobs?: BackupJobItem[]
        apiUsage?: ApiUsageSummary
        storage?: StorageSummary
      }
      if (result.success) {
        const backupList = result.backups || []
        const twitterBackups = backupList.filter((backup) => inferBackupPlatform(backup) === 'twitter')
        setAllBackups(backupList)
        setBackups(twitterBackups)
        setBackupsCount(twitterBackups.length)
        setJobs(result.jobs || [])
        setApiUsage(result.apiUsage || null)
        const summaryBytes = result.storage ? parseSizeValue(result.storage.totalBytes) : null
        setReportedTotalStorageBytes(summaryBytes)
        if (result.storage?.limitBytes) {
          setReportedStorageLimitBytes(result.storage.limitBytes)
        }
      }
    } catch (error) {
      console.error('Error fetching backups count:', error)
      setApiUsage(null)
      setReportedTotalStorageBytes(null)
    } finally {
      setLoadingBackups(false)
    }
  }, [])

  const fetchArchiveWizardStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/archive-wizard/status', { cache: 'no-store' })
      const result = (await response.json()) as ArchiveWizardStatusResponse
      if (!response.ok || !result.success) return

      const resolvedStatus = result.status || (result.hasArchiveBackup ? 'completed' : null)
      setArchiveWizardStatus(resolvedStatus)
      setArchiveRequestedAt(result.archiveRequestedAt || null)
    } catch (error) {
      console.error('Error fetching archive wizard status:', error)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      if (!currentUser) {
        router.push('/login')
        return
      }

      setUser(currentUser)

      const metadataName =
        (currentUser.user_metadata?.full_name as string | undefined) ||
        (currentUser.user_metadata?.name as string | undefined) ||
        (currentUser.user_metadata?.display_name as string | undefined) ||
        ''

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', currentUser.id)
        .maybeSingle()

      const resolvedName =
        profile?.display_name || metadataName || currentUser.email?.split('@')[0] || 'User'
      setDisplayName(resolvedName)

      if (!profile?.display_name && metadataName) {
        await supabase.from('profiles').update({ display_name: metadataName }).eq('id', currentUser.id)
      }

      setTwitterUsername(
        (currentUser.user_metadata?.user_name as string | undefined) ||
          (currentUser.user_metadata?.preferred_username as string | undefined) ||
          ''
      )

      await Promise.all([fetchBackupsSummary(), fetchArchiveWizardStatus()])
      setAuthLoading(false)
    }

    init()
  }, [fetchArchiveWizardStatus, fetchBackupsSummary, router, supabase])

  const hasActiveJob = jobs.some((job) => job.status === 'queued' || job.status === 'processing')
  const activeJob = jobs.find((job) => job.status === 'queued' || job.status === 'processing') || null

  useEffect(() => {
    if (!user || !hasActiveJob) return

    const interval = setInterval(() => {
      void fetchBackupsSummary()
    }, 1500)

    return () => clearInterval(interval)
  }, [fetchBackupsSummary, hasActiveJob, user])

  useEffect(() => {
    if (!tabParam) return
    const validTabs: DashboardTab[] = ['twitter', 'instagram', 'tiktok', 'all-backups', 'account']
    if (!validTabs.includes(tabParam as DashboardTab)) return
    setActiveTab(tabParam as DashboardTab)
  }, [tabParam])

  useEffect(() => {
    if (archiveRequestedParam !== '1') return
    setArchiveSetupMessage(
      "Great! Twitter usually takes 24-48 hours to prepare your archive. We'll email you when it's time to download."
    )
  }, [archiveRequestedParam])

  useEffect(() => {
    const existing = new Set(allBackups.map((backup) => backup.id))
    setSelectedBackupIds((prev) => prev.filter((id) => existing.has(id)))
  }, [allBackups])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleDeleteBackup = async (backupId: string, label: string) => {
    setDeleteError(null)
    setPendingDelete({ backupIds: [backupId], label })
  }

  const handleDeleteSelectedBackups = () => {
    if (selectedBackupIds.length === 0) return
    setDeleteError(null)
    setPendingDelete({
      backupIds: selectedBackupIds,
      label: `${selectedBackupIds.length} selected backup${selectedBackupIds.length === 1 ? '' : 's'}`,
    })
  }

  const confirmDeleteBackup = async () => {
    if (!pendingDelete) return
    setDeletingBackup(true)
    setDeleteError(null)

    try {
      const response = await fetch('/api/backups/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          backupIds: pendingDelete.backupIds,
        }),
      })
      const result = await response.json()

      if (!result.success) {
        await fetchBackupsSummary()
        throw new Error(result.error || 'Failed to delete backup')
      }

      await fetchBackupsSummary()
      setSelectedBackupIds((prev) => prev.filter((id) => !pendingDelete.backupIds.includes(id)))
      setPendingDelete(null)
      setDeleteError(null)
    } catch (error) {
      console.error('Delete backup error:', error)
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete backup')
    } finally {
      setDeletingBackup(false)
    }
  }

  const handleDownloadBackup = async (backupId: string) => {
    try {
      const response = await fetch(`/api/platforms/twitter/download-archive?backupId=${encodeURIComponent(backupId)}`)
      const data = await response.json()

      if (!response.ok || !data.success || !data.downloadUrl) {
        throw new Error(data.error || 'This backup does not have a downloadable archive.')
      }

      window.location.href = data.downloadUrl
    } catch (error) {
      console.error('Download backup error:', error)
      alert(error instanceof Error ? error.message : 'Failed to download backup.')
    }
  }

  const handleCancelJob = async (jobId: string) => {
    const response = await fetch('/api/backups/jobs/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    })
    const result = await response.json()
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to cancel job')
    }
    await fetchBackupsSummary()
  }

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadProgressPercent(0)
    setUploadProgressDetail('Preparing upload...')
    setUploadResult(null)

    try {
      const data = await uploadTwitterArchiveDirect({
        file,
        username: twitterUsername || undefined,
        onProgress: (progress: DirectUploadProgress) => {
          setUploadProgressPercent(progress.percent)
          setUploadProgressDetail(progress.detail || null)
        },
      })
      setUploadResult(data as UploadResult)

      if (data.success) {
        await Promise.all([
          fetchBackupsSummary(),
          fetch('/api/archive-wizard/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          }).catch(() => null),
          fetchArchiveWizardStatus(),
        ])
      }
    } catch (error) {
      console.error('Upload error:', error)
      setUploadResult({ success: false, error: 'Failed to upload archive' })
    } finally {
      setUploading(false)
      setUploadProgressPercent(0)
      setUploadProgressDetail(null)
    }
  }

  const handleScrapeNow = async (targets: TwitterScrapeTargets) => {
    if (!twitterUsername.trim()) return
    if (!Object.values(targets).some(Boolean)) {
      setScrapeResult({ success: false, error: 'Select at least one data type to scrape.' })
      return
    }

    setScraping(true)
    setScrapeResult(null)

    try {
      const response = await fetch('/api/platforms/twitter/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: twitterUsername.trim(),
          targets,
        }),
      })

      const data = (await response.json()) as ScrapeResult
      setScrapeResult(data)

      if (data.success) {
        await fetchBackupsSummary()
      }
    } catch (error) {
      console.error('Scrape error:', error)
      setScrapeResult({ success: false, error: 'Failed to scrape X data' })
    } finally {
      setScraping(false)
    }
  }

  if (authLoading) {
    return <ThemeLoadingScreen label="Loading your dashboard..." />
  }

  if (!user) {
    return null
  }

  const recentBackups = backups.slice(0, 5)
  const backupsByPlatform = allBackups.reduce(
    (acc, backup) => {
      const platformId = inferBackupPlatform(backup)
      acc[platformId] += 1
      return acc
    },
    { twitter: 0, instagram: 0, tiktok: 0 } as Record<PlatformId, number>
  )
  const platformScopedBackups = allBackupsFilter === 'all'
    ? allBackups
    : allBackups.filter((backup) => inferBackupPlatform(backup) === allBackupsFilter)
  const typeFilteredBackups = platformScopedBackups.filter((backup) => {
    if (allBackupsTypeFilter === 'all') return true
    if (allBackupsTypeFilter === 'archive') return isArchiveBackup(backup)
    return !isArchiveBackup(backup)
  })
  const filteredAllBackups = [...typeFilteredBackups].sort((a, b) => {
    const timeA = new Date(a.uploaded_at || a.created_at || 0).getTime()
    const timeB = new Date(b.uploaded_at || b.created_at || 0).getTime()
    const sizeA = resolveBackupSize(a)
    const sizeB = resolveBackupSize(b)
    if (allBackupsSort === 'oldest') return timeA - timeB
    if (allBackupsSort === 'size_desc') return sizeB - sizeA
    if (allBackupsSort === 'size_asc') return sizeA - sizeB
    return timeB - timeA
  })
  const platformArchiveCount = platformScopedBackups.filter((backup) => isArchiveBackup(backup)).length
  const platformSnapshotCount = platformScopedBackups.filter((backup) => !isArchiveBackup(backup)).length
  const platformStorageBytes = platformScopedBackups.reduce((sum, backup) => sum + resolveBackupSize(backup), 0)
  const allBackupsEstimatedStorageBytes = allBackups.reduce((sum, backup) => sum + resolveBackupSize(backup), 0)
  const accountStorageBytes = reportedTotalStorageBytes ?? allBackupsEstimatedStorageBytes
  const inProgressJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'processing')
  const filteredBackupIdSet = new Set(filteredAllBackups.map((backup) => backup.id))
  const selectedVisibleCount = selectedBackupIds.filter((id) => filteredBackupIdSet.has(id)).length
  const allVisibleSelected = filteredAllBackups.length > 0 && selectedVisibleCount === filteredAllBackups.length

  const toggleBackupSelection = (backupId: string) => {
    setSelectedBackupIds((prev) => {
      if (prev.includes(backupId)) return prev.filter((id) => id !== backupId)
      return [...prev, backupId]
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedBackupIds((prev) => {
      const visibleIds = filteredAllBackups.map((backup) => backup.id)
      const prevSet = new Set(prev)
      const everyVisibleSelected = visibleIds.every((id) => prevSet.has(id))
      if (everyVisibleSelected) {
        return prev.filter((id) => !filteredBackupIdSet.has(id))
      }
      visibleIds.forEach((id) => prevSet.add(id))
      return Array.from(prevSet)
    })
  }

  const renderPlatformIcon = (platformId: PlatformId) => {
    if (platformId === 'twitter') return <XLogo />
    if (platformId === 'instagram') return <InstagramLogo />
    return <TikTokLogo />
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#22325f_0%,#121a34_35%,#0a1024_65%,#050813_100%)] text-gray-900 dark:text-white">
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-10 pt-5 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-white/15 bg-[#081331]/88 p-4 shadow-[0_18px_55px_rgba(1,4,15,0.42)] backdrop-blur sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Image
                src="/logo-square.png"
                alt="Social Backup logo"
                width={602}
                height={602}
                priority
                className="h-11 w-11 rounded-xl border border-white/20 bg-[#0b1738] p-1"
              />
              <div>
                <div className="inline-flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200/70">Social Backup</p>
                  <span className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                    Beta
                  </span>
                </div>
                <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-max items-center gap-2">
                <p className="mr-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200/70">Platforms</p>
                {platforms.map((platform) => (
                  <button
                    key={platform.id}
                    onClick={() => setActiveTab(platform.id)}
                    aria-label={platform.label}
                    title={platform.label}
                    className={`group relative flex h-11 w-11 items-center justify-center rounded-xl border transition ${
                      activeTab === platform.id
                        ? 'border-blue-300/80 bg-gradient-to-b from-blue-400/45 to-blue-600/45 shadow-[0_12px_24px_rgba(37,99,235,0.35)]'
                        : 'border-white/15 bg-white/5 hover:border-white/35 hover:bg-white/10'
                    } ${!platform.enabled ? 'opacity-60' : ''}`}
                  >
                    <span className="scale-[0.82]">{renderPlatformIcon(platform.id)}</span>
                  </button>
                ))}
                <div className="mx-1 h-7 w-px bg-white/20" />
                <button
                  onClick={() => setActiveTab('all-backups')}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    activeTab === 'all-backups'
                      ? 'border-blue-300/80 bg-gradient-to-b from-blue-400/45 to-blue-600/45 text-white shadow-[0_12px_24px_rgba(37,99,235,0.35)]'
                      : 'border-white/15 bg-white/5 text-blue-100 hover:border-white/35 hover:bg-white/10'
                  }`}
                >
                  <FolderArchive size={15} />
                  <span>All Backups</span>
                </button>
                <button
                  onClick={() => setActiveTab('account')}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    activeTab === 'account'
                      ? 'border-blue-300/80 bg-gradient-to-b from-blue-400/45 to-blue-600/45 text-white shadow-[0_12px_24px_rgba(37,99,235,0.35)]'
                      : 'border-white/15 bg-white/5 text-blue-100 hover:border-white/35 hover:bg-white/10'
                  }`}
                >
                  <UserRound size={15} />
                  <span>Account</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="pt-7">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-3 px-1">
            <div>
              <h2 className="text-2xl font-bold text-white sm:text-3xl">Hi, {displayName}</h2>
              <p className="mt-1 text-sm text-blue-100/85">Keep your social history safe and accessible.</p>
            </div>
            <div className="hidden rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-right text-sm text-blue-100/85 sm:block">
              <p className="font-semibold text-white">{displayName}</p>
              <p>Free Plan</p>
            </div>
          </div>

          {archiveSetupMessage && (
            <section className="mb-6 rounded-2xl border border-emerald-300/35 bg-emerald-500/15 p-4 text-sm text-emerald-100">
              <div className="flex items-start justify-between gap-3">
                <p>{archiveSetupMessage}</p>
                <button
                  type="button"
                  onClick={() => setArchiveSetupMessage(null)}
                  className="rounded-full border border-emerald-200/30 px-2.5 py-1 text-xs font-semibold text-emerald-100/90 hover:bg-emerald-500/20"
                >
                  Dismiss
                </button>
              </div>
            </section>
          )}

          {(archiveWizardStatus === 'pending' || archiveWizardStatus === 'pending_extended') && (
            <DashboardBanner
              status={archiveWizardStatus}
              archiveRequestedAt={archiveRequestedAt}
            />
          )}

          {activeTab === 'twitter' && backupsCount === 0 && archiveWizardStatus !== 'completed' && (
            <section className="mb-6 rounded-3xl border border-blue-300/35 bg-blue-500/12 p-6 shadow-[0_12px_30px_rgba(3,25,63,0.3)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100/75">Onboarding</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Back up your Twitter data</h3>
              <p className="mt-2 text-sm text-blue-100/80">
                Start the archive wizard to request your Twitter archive now and upload it when it&apos;s ready.
              </p>
              <a
                href="/dashboard/archive-wizard"
                className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-gray-200 sm:w-auto"
              >
                Start Archive Wizard
              </a>
            </section>
          )}

          {activeTab === 'twitter' && (
            <TwitterPanel
              backupsCount={backupsCount}
              loadingBackups={loadingBackups}
              recentBackups={recentBackups}
              jobs={jobs}
              activeJob={activeJob}
              uploading={uploading}
              uploadProgressPercent={uploadProgressPercent}
              uploadProgressDetail={uploadProgressDetail}
              uploadResult={uploadResult}
              scraping={scraping}
              scrapeResult={scrapeResult}
              twitterUsername={twitterUsername}
              setTwitterUsername={setTwitterUsername}
              scrapeTargets={twitterScrapeTargets}
              setScrapeTargets={setTwitterScrapeTargets}
              apiUsage={apiUsage}
              onCancelJob={handleCancelJob}
              onViewBackups={() => setActiveTab('all-backups')}
              onOpenBackup={(backupId) => router.push(`/dashboard/backup/${backupId}`)}
              onDownloadBackup={handleDownloadBackup}
              onDeleteBackup={handleDeleteBackup}
              onUploadChange={handleFileUpload}
              onScrapeNow={handleScrapeNow}
            />
          )}

          {activeTab === 'instagram' && <InstagramPanel />}

          {activeTab === 'tiktok' && <TikTokPanel />}

          {activeTab === 'all-backups' && (
            <section className="rounded-3xl border border-white/15 bg-[#0f1937]/92 p-6 shadow-[0_14px_40px_rgba(4,10,28,0.35)] sm:p-7">
              <div className="border-b border-white/10 pb-5">
                <h3 className="text-2xl font-bold text-white sm:text-3xl">Your Backups</h3>
                <p className="mt-2 text-base text-blue-100/80">Open and manage your archived snapshots.</p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-[#0a1430] px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-blue-200/65">Total Archives</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{platformArchiveCount}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1430] px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-blue-200/65">Total Snapshots</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{platformSnapshotCount}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0a1430] px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-blue-200/65">Total Storage Used</p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {formatSize(accountStorageBytes)}
                  </p>
                  {allBackupsFilter !== 'all' && (
                    <p className="mt-1 text-xs text-blue-100/70">
                      Filtered estimate: {formatSize(platformStorageBytes)}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-blue-100/70">Limit: {formatSizeForLimit(reportedStorageLimitBytes)}</p>
                  <p className="mt-1 text-xs text-blue-100/70">
                    Snapshot tokens this month: ${apiUsage?.spentUsd?.toFixed(2) || '0.00'} / ${apiUsage?.limitUsd?.toFixed(2) || '0.00'}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0a1430] p-2">
                {([
                  { id: 'all', label: 'All', count: allBackups.length },
                  { id: 'twitter', label: 'X', count: backupsByPlatform.twitter },
                  { id: 'instagram', label: 'Instagram', count: backupsByPlatform.instagram },
                  { id: 'tiktok', label: 'TikTok', count: backupsByPlatform.tiktok },
                ] as Array<{ id: AllBackupsFilter; label: string; count: number }>).map((filterTab) => (
                  <button
                    key={filterTab.id}
                    onClick={() => setAllBackupsFilter(filterTab.id)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      allBackupsFilter === filterTab.id
                        ? 'bg-blue-500/35 text-white'
                        : 'text-blue-100/80 hover:bg-white/10'
                    }`}
                  >
                    {filterTab.label} ({filterTab.count})
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex w-full flex-wrap rounded-2xl border border-white/10 bg-[#0a1430] p-1 sm:inline-flex sm:w-auto sm:rounded-full">
                  <button
                    onClick={() => setAllBackupsTypeFilter('all')}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm sm:flex-none ${
                      allBackupsTypeFilter === 'all' ? 'bg-white text-black' : 'text-blue-100/85'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setAllBackupsTypeFilter('archive')}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm sm:flex-none ${
                      allBackupsTypeFilter === 'archive' ? 'bg-white text-black' : 'text-blue-100/85'
                    }`}
                  >
                    Archives
                  </button>
                  <button
                    onClick={() => setAllBackupsTypeFilter('snapshot')}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm sm:flex-none ${
                      allBackupsTypeFilter === 'snapshot' ? 'bg-white text-black' : 'text-blue-100/85'
                    }`}
                  >
                    Snapshots
                  </button>
                </div>

                <div className="inline-flex w-full items-center justify-between gap-2 rounded-full border border-white/10 bg-[#0a1430] px-3 py-2 sm:w-auto sm:justify-start">
                  <span className="text-sm text-blue-100/70">Sort</span>
                  <select
                    value={allBackupsSort}
                    onChange={(e) => setAllBackupsSort(e.target.value as AllBackupsSort)}
                    className="w-[10.5rem] bg-transparent text-sm text-white outline-none"
                  >
                    <option className="bg-[#09112a]" value="newest">Newest</option>
                    <option className="bg-[#09112a]" value="oldest">Oldest</option>
                    <option className="bg-[#09112a]" value="size_desc">Largest Size</option>
                    <option className="bg-[#09112a]" value="size_asc">Smallest Size</option>
                  </select>
                </div>
              </div>

              {!loadingBackups && filteredAllBackups.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0a1430] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={toggleSelectAllVisible}
                    className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-white/10"
                  >
                    {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBackupIds([])}
                    disabled={selectedBackupIds.length === 0}
                    className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear selection
                  </button>
                  <span className="text-xs text-blue-100/70">
                    {selectedBackupIds.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedBackups}
                    disabled={selectedBackupIds.length === 0 || deletingBackup}
                    className="ml-auto rounded-full border border-red-500/50 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete selected
                  </button>
                </div>
              )}

              {inProgressJobs.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-blue-100/80">
                    In-progress jobs ({inProgressJobs.length})
                  </p>
                  {inProgressJobs.map((job) => {
                    const jobLabel = job.job_type === 'archive_upload' ? 'Archive upload' : 'Snapshot scrape'
                    const progress = Math.max(0, Math.min(100, Number(job.progress) || 0))
                    return (
                      <article
                        key={job.id}
                        className="rounded-2xl border border-blue-300/30 bg-blue-500/10 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {jobLabel} ({job.status === 'queued' ? 'Queued' : 'Processing'})
                            </p>
                            <p className="mt-1 text-sm text-blue-100/85">
                              {job.message || 'Running in the background...'}
                            </p>
                            <p className="mt-1 text-xs text-blue-100/65">
                              Started {formatDate(job.started_at || job.created_at || null)}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              void handleCancelJob(job.id).catch((error) =>
                                console.error('Cancel backup job error:', error),
                              )
                            }}
                            className="rounded-full border border-red-500/50 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/30"
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}

              <p className="mt-3 text-sm text-blue-100/70">
                Showing {filteredAllBackups.length} backup{filteredAllBackups.length === 1 ? '' : 's'}
                {inProgressJobs.length > 0 ? ` and ${inProgressJobs.length} in-progress job${inProgressJobs.length === 1 ? '' : 's'}.` : '.'}
              </p>

              <div className="mt-4 space-y-3">
                {loadingBackups ? (
                  <p className="text-sm text-blue-100/80">Loading backups...</p>
                ) : filteredAllBackups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/20 bg-[#0a1430] p-8 text-center">
                    <p className="text-blue-100/75">No backups match this filter.</p>
                    <button
                      onClick={() => {
                        setAllBackupsFilter('all')
                        setAllBackupsTypeFilter('all')
                      }}
                      className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-gray-200"
                    >
                      Show all backups
                    </button>
                  </div>
                ) : (
                  filteredAllBackups.map((backup) => {
                    const partial = getBackupPartialDetails(backup)
                    const isArchive = isArchiveBackup(backup)
                    const methodLabel = backup.backup_name || formatBackupMethodLabel(backup)
                    const platformId = inferBackupPlatform(backup)
                    const partialTitle = partial.reasons.length > 0
                      ? partial.reasons.map((reason) => formatPartialReasonLabel(reason)).join(' • ')
                      : 'This snapshot did not complete all requested data.'

                    return (
                      <article
                        key={backup.id}
                        className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-white/10 bg-[#101b3d] p-4 transition hover:border-white/20 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="self-center">
                          <input
                            type="checkbox"
                            aria-label={`Select ${methodLabel}`}
                            checked={selectedBackupIds.includes(backup.id)}
                            onChange={() => toggleBackupSelection(backup.id)}
                            className="h-4 w-4 cursor-pointer rounded border-white/30 bg-transparent text-blue-400 focus:ring-blue-400"
                          />
                        </div>
                        <div
                          className="flex min-w-0 cursor-pointer items-center gap-4"
                          onClick={() => router.push(`/dashboard/backup/${backup.id}`)}
                        >
                          <div
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                              isArchive
                                ? 'bg-indigo-500/25 text-indigo-300'
                                : 'bg-pink-500/25 text-pink-300'
                            }`}
                          >
                            {isArchive ? <FileArchive size={20} /> : <Globe size={20} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-blue-300/30 bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-100">
                                {platformId === 'twitter' ? 'X' : platformId === 'instagram' ? 'Instagram' : 'TikTok'}
                              </span>
                              <p className="truncate text-[0.98rem] font-semibold text-white">{methodLabel}</p>
                              {partial.isPartial && (
                                <span
                                  title={partialTitle}
                                  className="inline-flex shrink-0 items-center rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                                >
                                  Partial
                                </span>
                              )}
                            </div>
                            <p className="text-[0.9rem] text-blue-100/75">{formatDate(backup.uploaded_at || backup.created_at)}</p>
                          </div>
                        </div>

                        <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
                          <p className="w-full font-mono tabular-nums text-[0.92rem] font-medium text-blue-100/90 sm:mr-2 sm:w-auto">
                            {formatSize(resolveBackupSize(backup))}
                          </p>
                          <a
                            href={`/dashboard/backup/${backup.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-200 sm:flex-none"
                          >
                            View
                            <ExternalLink size={14} />
                          </a>
                          <button
                            onClick={() => {
                              void handleDownloadBackup(backup.id)
                            }}
                            disabled={!isArchive}
                            className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => handleDeleteBackup(backup.id, methodLabel)}
                            className="flex-1 rounded-full border border-red-500/50 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/30 sm:flex-none"
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    )
                  })
                )}
              </div>
            </section>
          )}

          {activeTab === 'account' && (
            <section className="rounded-3xl border border-white/15 bg-[#0f1937]/92 p-7 shadow-[0_14px_40px_rgba(4,10,28,0.35)]">
              <h3 className="text-xl font-semibold text-white">Account</h3>
              <div className="mt-4 space-y-3 text-sm">
                <p className="text-blue-100/80">
                  <span className="font-medium text-white">Name:</span> {displayName}
                </p>
                <p className="text-blue-100/80">
                  <span className="font-medium text-white">Email:</span> {user.email}
                </p>
                <p className="text-blue-100/80">
                  <span className="font-medium text-white">User ID:</span> {user.id}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="mt-6 rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Sign Out
              </button>
            </section>
          )}
        </main>
      </div>
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#101524] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <h3 className="text-lg font-semibold text-white">
              {pendingDelete.backupIds.length > 1 ? 'Delete Backups' : 'Delete Backup'}
            </h3>
            <p className="mt-2 text-sm text-gray-300">
              Delete <span className="font-semibold text-white">{pendingDelete.label}</span>? This cannot be undone.
            </p>
            {deleteError && <p className="mt-3 text-sm text-red-300">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  if (deletingBackup) return
                  setPendingDelete(null)
                  setDeleteError(null)
                }}
                disabled={deletingBackup}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBackup}
                disabled={deletingBackup}
                className="rounded-full border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingBackup
                  ? `Deleting${pendingDelete.backupIds.length > 1 ? ' backups' : ''}...`
                  : `Delete${pendingDelete.backupIds.length > 1 ? ' all' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
