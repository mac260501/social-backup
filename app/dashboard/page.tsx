'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  Archive,
  CheckCircle2,
  CloudUpload,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { AppModeTabs } from '@/components/app-mode-tabs'
import { ScanComingSoonPanel } from '@/components/scan-coming-soon-panel'
import {
  formatBackupMethodLabel,
  formatPartialReasonLabel,
  getBackupPartialDetails,
  inferBackupPlatform,
  isArchiveBackup,
} from '@/lib/platforms/backup'
import {
  deriveDefaultArchiveImportSelection,
  hasSelectedArchiveImportCategory,
  normalizeArchivePreviewData,
  type ArchiveImportSelection,
  type ArchivePreviewData,
} from '@/lib/platforms/twitter/archive-import'
import { extractDirectMessagesFromArchiveFile } from '@/lib/platforms/twitter/archive-dm-extract'
import {
  encryptDirectMessagesForClientStorage,
  generateRecoveryKey,
} from '@/lib/platforms/twitter/dm-crypto'
import {
  discardStagedTwitterArchive,
  startTwitterArchiveImport,
  type DirectUploadProgress,
  uploadEncryptedDmPayloadToStaging,
  uploadTwitterArchiveToStaging,
} from '@/lib/platforms/twitter/direct-upload'
import { encryptAndUploadArchiveInChunks } from '@/lib/platforms/twitter/encrypted-archive-upload'
import { createClient } from '@/lib/supabase/client'

type TwitterScrapeTargets = {
  profile: boolean
  tweets: boolean
  replies: boolean
  followers: boolean
  following: boolean
}

type DashboardBackupItem = {
  id: string
  backup_type?: string | null
  source?: string | null
  backup_name?: string | null
  backup_source?: string | null
  uploaded_at?: string | null
  created_at?: string | null
  file_size?: number | null
  data?: {
    profile?: {
      username?: string
    }
    archive_file_path?: string
    encrypted_archive?: unknown
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

type BackupJobItem = {
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

type UploadResult = {
  success: boolean
  message?: string
  error?: string
  job?: {
    id: string
    status: 'queued' | 'processing' | 'completed' | 'failed'
    progress: number
    message?: string | null
  }
}

type ScrapeResult = {
  success: boolean
  message?: string
  error?: string
}

type SnapshotSelection = {
  tweets: boolean
  replies: boolean
  media: boolean
  followers: boolean
  following: boolean
}

type StagedArchiveState = {
  stagedInputPath: string
  fileName: string
  fileType: string
  fileSize: number
  file: File
  preview: ArchivePreviewData
  importSelection: ArchiveImportSelection
  dmEncryptionEnabled: boolean
  dmPassphrase: string
  dmPassphraseConfirm: string
  dmRecoveryKey: string
  dmRecoveryKeySaved: boolean
  storeEncryptedArchive: boolean
}

type BackupsApiResponse = {
  success?: boolean
  backups?: DashboardBackupItem[]
  jobs?: BackupJobItem[]
  apiUsage?: {
    monthStartIso?: string
    spentUsd?: number
    limitUsd?: number
    remainingUsd?: number
  }
  storage?: {
    totalBytes?: number
    limitBytes?: number
    remainingBytes?: number
  }
  scrapeLimits?: {
    maxTweetsAndReplies?: number
    maxFollowersAndFollowing?: number
  }
  error?: string
}

type PlatformVoteState = 'idle' | 'saving' | 'saved' | 'error'
type PlatformVoteMap = Record<'instagram' | 'tiktok', PlatformVoteState>

type PendingEncryptedArchiveStorageState = {
  jobId: string
  backupId: string | null
  knownBackupIdsAtQueue: string[]
  file: File
  passphrase: string
  recoveryKey: string
  status: 'waiting_backup' | 'running' | 'completed' | 'failed'
  progressPercent: number
  detail: string | null
  error: string | null
}

type CompletedJobNotice = {
  id: string
  message: string
}

type DeleteConfirmTarget = {
  id: string
  label: string
}

const BACKUPS_PAGE_SIZE = 8

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

function formatStorage(bytes?: number) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return '0 MB'
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function formatUsd(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return '$0.00'
  return `$${value.toFixed(2)}`
}

function normalizeJobProgress(progress: unknown) {
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

function estimateEtaSecondsForJob(job: BackupJobItem, progress: number, statusMessage: string): number | null {
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

function getJobEtaLabel(job: BackupJobItem): string | null {
  const progress = normalizeJobProgress(job.progress)
  const statusMessage = job.message || ''
  const etaSeconds = estimateEtaSecondsForJob(job, progress, statusMessage)
  return etaSeconds === null ? null : formatEta(etaSeconds)
}

function summarizeArchivePreview(preview: ArchivePreviewData) {
  return [
    `${preview.stats.tweets.toLocaleString()} tweets`,
    `${preview.stats.media_files.toLocaleString()} media files`,
    `${preview.stats.followers.toLocaleString()} followers`,
    `${preview.stats.following.toLocaleString()} following`,
  ].join(' • ')
}

export default function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [isDark, setIsDark] = useState(false)

  const [mode, setMode] = useState<'upload' | 'snapshot'>('snapshot')

  const [backups, setBackups] = useState<DashboardBackupItem[]>([])
  const [jobs, setJobs] = useState<BackupJobItem[]>([])
  const [backupsPage, setBackupsPage] = useState(1)
  const [loadingBackups, setLoadingBackups] = useState(true)
  const [apiUsage, setApiUsage] = useState<BackupsApiResponse['apiUsage'] | null>(null)
  const [storageSummary, setStorageSummary] = useState<BackupsApiResponse['storage'] | null>(null)
  const [scrapeLimits, setScrapeLimits] = useState<BackupsApiResponse['scrapeLimits'] | null>(null)

  const [twitterUsername, setTwitterUsername] = useState('')
  const [snapshotSelection, setSnapshotSelection] = useState<SnapshotSelection>({
    tweets: true,
    replies: true,
    media: true,
    followers: true,
    following: true,
  })
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null)

  const [uploading, setUploading] = useState(false)
  const [analyzingArchive, setAnalyzingArchive] = useState(false)
  const [startingArchiveImport, setStartingArchiveImport] = useState(false)
  const [isArchiveDragActive, setIsArchiveDragActive] = useState(false)
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0)
  const [uploadProgressDetail, setUploadProgressDetail] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [stagedArchive, setStagedArchive] = useState<StagedArchiveState | null>(null)
  const [encryptedArchiveTask, setEncryptedArchiveTask] = useState<PendingEncryptedArchiveStorageState | null>(null)
  const encryptedArchiveAutoStartKeyRef = useRef<string | null>(null)
  const [recoveryKeyCopied, setRecoveryKeyCopied] = useState(false)

  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<DeleteConfirmTarget | null>(null)
  const [completedJobNotice, setCompletedJobNotice] = useState<CompletedJobNotice | null>(null)
  const activeJobIdsRef = useRef<Set<string>>(new Set())
  const [platformVotes, setPlatformVotes] = useState<PlatformVoteMap>({
    instagram: 'idle',
    tiktok: 'idle',
  })

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggleTheme = () => {
    const nextIsDark = !isDark
    setIsDark(nextIsDark)
    document.documentElement.classList.toggle('dark', nextIsDark)
    window.localStorage.setItem('theme', nextIsDark ? 'dark' : 'light')
  }

  const fetchBackupsSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/backups', { cache: 'no-store' })
      const result = (await response.json()) as BackupsApiResponse
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load backups')
      }

      const backupList = result.backups || []
      const twitterBackups = backupList.filter((backup) => inferBackupPlatform(backup) === 'twitter')
      setBackups(twitterBackups)
      setJobs(result.jobs || [])
      setApiUsage(result.apiUsage || null)
      setStorageSummary(result.storage || null)
      setScrapeLimits(result.scrapeLimits || null)
    } catch (error) {
      console.error('Error fetching backups summary:', error)
      setApiUsage(null)
      setStorageSummary(null)
      setScrapeLimits(null)
    } finally {
      setLoadingBackups(false)
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

      const profileDisplayName = typeof profile?.display_name === 'string' ? profile.display_name.trim() : ''
      const hasCustomProfileName = profileDisplayName.length > 0 && !/^guest$/i.test(profileDisplayName)
      const resolvedName = hasCustomProfileName
        ? profileDisplayName
        : metadataName || currentUser.email?.split('@')[0] || 'User'
      setDisplayName(resolvedName)

      if ((!hasCustomProfileName || !profileDisplayName) && metadataName) {
        await supabase.from('profiles').update({ display_name: metadataName }).eq('id', currentUser.id)
      }

      setTwitterUsername(
        (currentUser.user_metadata?.user_name as string | undefined) ||
          (currentUser.user_metadata?.preferred_username as string | undefined) ||
          ''
      )

      await fetchBackupsSummary()
      setAuthLoading(false)
    }

    void init()
  }, [fetchBackupsSummary, router, supabase])

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
    if (!scrapeResult?.success) return
    const timeout = window.setTimeout(() => {
      setScrapeResult((prev) => (prev?.success ? null : prev))
    }, 2600)
    return () => window.clearTimeout(timeout)
  }, [scrapeResult])

  useEffect(() => {
    if (!uploadResult?.success) return
    const timeout = window.setTimeout(() => {
      setUploadResult((prev) => (prev?.success ? null : prev))
    }, 2600)
    return () => window.clearTimeout(timeout)
  }, [uploadResult])

  useEffect(() => {
    const currentActiveJobIds = new Set(
      jobs
        .filter((job) => job.status === 'queued' || job.status === 'processing')
        .map((job) => job.id),
    )

    const completedJob = jobs.find(
      (job) =>
        activeJobIdsRef.current.has(job.id) &&
        !currentActiveJobIds.has(job.id) &&
        job.status === 'completed',
    )

    if (completedJob) {
      setCompletedJobNotice({
        id: completedJob.id,
        message: completedJob.job_type === 'archive_upload' ? 'Archive import completed' : 'Snapshot completed',
      })
      setScrapeResult((prev) => (prev?.success ? null : prev))
      setUploadResult((prev) => (prev?.success ? null : prev))
    }

    activeJobIdsRef.current = currentActiveJobIds
  }, [jobs])

  useEffect(() => {
    if (!completedJobNotice) return
    const timeout = window.setTimeout(() => {
      setCompletedJobNotice((prev) => (prev?.id === completedJobNotice.id ? null : prev))
    }, 3200)
    return () => window.clearTimeout(timeout)
  }, [completedJobNotice])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('platform-request-votes:v1')
      if (!raw) return
      const parsed = JSON.parse(raw) as { instagram?: boolean; tiktok?: boolean }
      setPlatformVotes((prev) => ({
        instagram: parsed.instagram ? 'saved' : prev.instagram,
        tiktok: parsed.tiktok ? 'saved' : prev.tiktok,
      }))
    } catch {
      // Ignore localStorage parsing errors and keep defaults.
    }
  }, [])

  useEffect(() => {
    setRecoveryKeyCopied(false)
  }, [stagedArchive?.stagedInputPath])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handlePlatformVote = async (platform: 'instagram' | 'tiktok') => {
    setPlatformVotes((prev) => ({ ...prev, [platform]: 'saving' }))
    try {
      const response = await fetch('/api/feedback/platform-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      })
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save vote')
      }

      setPlatformVotes((prev) => ({ ...prev, [platform]: 'saved' }))
      try {
        const raw = window.localStorage.getItem('platform-request-votes:v1')
        const parsed = raw ? (JSON.parse(raw) as { instagram?: boolean; tiktok?: boolean }) : {}
        const next = { ...parsed, [platform]: true }
        window.localStorage.setItem('platform-request-votes:v1', JSON.stringify(next))
      } catch {
        // Ignore localStorage write errors.
      }
    } catch (error) {
      console.error('Platform vote error:', error)
      setPlatformVotes((prev) => ({ ...prev, [platform]: 'error' }))
      window.setTimeout(() => {
        setPlatformVotes((prev) => ({ ...prev, [platform]: 'idle' }))
      }, 1800)
    }
  }

  const handleCopyRecoveryKey = async () => {
    if (!stagedArchive?.dmRecoveryKey) return
    try {
      await navigator.clipboard.writeText(stagedArchive.dmRecoveryKey)
      setRecoveryKeyCopied(true)
      window.setTimeout(() => setRecoveryKeyCopied(false), 2000)
    } catch {
      setRecoveryKeyCopied(false)
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

  const handleDeleteBackup = async (backupId: string) => {
    if (deletingBackupId) return

    try {
      setDeletingBackupId(backupId)
      const response = await fetch(`/api/backups/delete?backupId=${encodeURIComponent(backupId)}`, {
        method: 'DELETE',
      })
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to delete backup.')
      }
      await fetchBackupsSummary()
    } catch (error) {
      console.error('Delete backup error:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete backup.')
    } finally {
      setDeletingBackupId(null)
      setDeleteConfirmTarget((prev) => (prev?.id === backupId ? null : prev))
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

  const discardStagedArchiveByPath = useCallback(async (stagedInputPath: string) => {
    if (!stagedInputPath) return
    await discardStagedTwitterArchive(stagedInputPath)
  }, [])

  const handleArchiveFile = useCallback(async (file: File) => {
    const previousStagedInputPath = stagedArchive?.stagedInputPath || ''

    setIsArchiveDragActive(false)
    setUploading(true)
    setAnalyzingArchive(false)
    setStartingArchiveImport(false)
    setUploadProgressPercent(0)
    setUploadProgressDetail('Preparing upload...')
    setUploadResult(null)
    setStagedArchive(null)

    if (previousStagedInputPath) {
      await discardStagedArchiveByPath(previousStagedInputPath)
    }

    let uploadedStagedInputPath = ''

    try {
      const stagedUpload = await uploadTwitterArchiveToStaging({
        file,
        onProgress: (progress: DirectUploadProgress) => {
          setUploadProgressPercent(progress.percent)
          setUploadProgressDetail(progress.detail || null)
        },
      })

      if (!stagedUpload.success || !stagedUpload.stagedInputPath) {
        throw new Error(stagedUpload.error || 'Failed to upload archive')
      }

      uploadedStagedInputPath = stagedUpload.stagedInputPath
      setUploadProgressDetail('Scanning archive contents...')
      setAnalyzingArchive(true)

      const previewResponse = await fetch('/api/platforms/twitter/upload-archive/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagedInputPath: stagedUpload.stagedInputPath,
        }),
      })
      const previewPayload = (await previewResponse.json().catch(() => ({}))) as {
        success?: boolean
        error?: string
        preview?: unknown
      }

      if (!previewResponse.ok || !previewPayload.success || !previewPayload.preview) {
        throw new Error(previewPayload.error || 'Failed to inspect uploaded archive')
      }

      const preview = normalizeArchivePreviewData(previewPayload.preview)
      if (!preview) {
        throw new Error('Failed to read archive preview data')
      }

      const importSelection = deriveDefaultArchiveImportSelection(preview.available)
      importSelection.direct_messages = false

      setStagedArchive({
        stagedInputPath: stagedUpload.stagedInputPath,
        fileName: stagedUpload.fileName || file.name,
        fileType: stagedUpload.fileType || file.type || 'application/zip',
        fileSize: stagedUpload.fileSize || file.size,
        file,
        preview,
        importSelection,
        dmEncryptionEnabled: false,
        dmPassphrase: '',
        dmPassphraseConfirm: '',
        dmRecoveryKey: preview.available.direct_messages ? generateRecoveryKey() : '',
        dmRecoveryKeySaved: false,
        storeEncryptedArchive: false,
      })

      setUploadResult({
        success: true,
        message: 'Archive uploaded. Ready to import.',
      })
    } catch (error) {
      console.error('Upload error:', error)
      setUploadResult({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload archive',
      })
      if (uploadedStagedInputPath) {
        await discardStagedArchiveByPath(uploadedStagedInputPath)
      }
      setStagedArchive(null)
    } finally {
      setUploading(false)
      setAnalyzingArchive(false)
      setUploadProgressPercent(0)
      setUploadProgressDetail(null)
    }
  }, [discardStagedArchiveByPath, stagedArchive?.stagedInputPath])

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await handleArchiveFile(file)
    e.target.value = ''
  }

  const handleArchiveDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (uploading || analyzingArchive || startingArchiveImport || hasActiveJob) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsArchiveDragActive(true)
  }

  const handleArchiveDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsArchiveDragActive(false)
  }

  const handleArchiveDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsArchiveDragActive(false)
    if (uploading || analyzingArchive || startingArchiveImport || hasActiveJob) return
    const droppedFile = event.dataTransfer.files?.[0]
    if (!droppedFile) return
    await handleArchiveFile(droppedFile)
  }

  const handleArchiveSelectionChange = useCallback((key: keyof ArchiveImportSelection, value: boolean) => {
    setStagedArchive((prev) => {
      if (!prev) return prev
      if (key === 'direct_messages') return prev
      if (!prev.preview.available[key] && value) return prev
      return {
        ...prev,
        importSelection: {
          ...prev.importSelection,
          [key]: value,
        },
      }
    })
  }, [])

  const handleIncludeEncryptedDmsChange = useCallback((enabled: boolean) => {
    setStagedArchive((prev) => {
      if (!prev) return prev
      if (enabled && !prev.preview.available.direct_messages) return prev
      return {
        ...prev,
        importSelection: {
          ...prev.importSelection,
          direct_messages: enabled,
        },
        dmEncryptionEnabled: enabled ? true : prev.storeEncryptedArchive ? true : prev.dmEncryptionEnabled,
        dmRecoveryKey: prev.dmRecoveryKey || generateRecoveryKey(),
        dmRecoveryKeySaved: enabled ? prev.dmRecoveryKeySaved : prev.dmRecoveryKeySaved,
      }
    })
  }, [])

  const handleDmPassphraseChange = useCallback((value: string) => {
    setStagedArchive((prev) => (prev ? { ...prev, dmPassphrase: value } : prev))
  }, [])

  const handleDmPassphraseConfirmChange = useCallback((value: string) => {
    setStagedArchive((prev) => (prev ? { ...prev, dmPassphraseConfirm: value } : prev))
  }, [])

  const handleDmRecoverySavedChange = useCallback((value: boolean) => {
    setStagedArchive((prev) => (prev ? { ...prev, dmRecoveryKeySaved: value } : prev))
  }, [])

  const handleStoreEncryptedArchiveChange = useCallback((value: boolean) => {
    setStagedArchive((prev) => {
      if (!prev) return prev
      if (!value) {
        return {
          ...prev,
          storeEncryptedArchive: false,
          dmEncryptionEnabled: prev.importSelection.direct_messages ? prev.dmEncryptionEnabled : false,
        }
      }
      return {
        ...prev,
        storeEncryptedArchive: true,
        dmEncryptionEnabled: true,
        dmRecoveryKey: prev.dmRecoveryKey || generateRecoveryKey(),
      }
    })
  }, [])

  const handleDiscardStagedArchive = useCallback(async () => {
    if (!stagedArchive) return
    await discardStagedArchiveByPath(stagedArchive.stagedInputPath)
    setStagedArchive(null)
    setUploadResult(null)
  }, [discardStagedArchiveByPath, stagedArchive])

  const handleStartArchiveImport = async () => {
    if (!stagedArchive) return
    if (!hasSelectedArchiveImportCategory(stagedArchive.importSelection)) {
      setUploadResult({ success: false, error: 'Select at least one archive category to import.' })
      return
    }
    if (dmEncryptionRequired) {
      if (!stagedArchive.dmEncryptionEnabled) {
        setUploadResult({
          success: false,
          error: 'Enable encryption setup before importing.',
        })
        return
      }
      if (stagedArchive.dmPassphrase.trim().length < 8) {
        setUploadResult({
          success: false,
          error: 'Passphrase must be at least 8 characters.',
        })
        return
      }
      if (stagedArchive.dmPassphrase !== stagedArchive.dmPassphraseConfirm) {
        setUploadResult({
          success: false,
          error: 'Passphrase confirmation does not match.',
        })
        return
      }
      if (!stagedArchive.dmRecoveryKeySaved) {
        setUploadResult({
          success: false,
          error: 'Confirm that you saved your recovery key before continuing.',
        })
        return
      }
    }

    setStartingArchiveImport(true)
    setUploadResult(null)
    let encryptedDmStagedInputPath = ''

    try {
      let dmEncryption: {
        encrypted_input_path: string
        conversation_count: number
        message_count: number
        version: number
      } | null = null

      if (stagedArchive.importSelection.direct_messages) {
        setUploadProgressDetail('Encrypting direct messages...')
        const extractionResult = await extractDirectMessagesFromArchiveFile(stagedArchive.file)
        const encryptedDmPayload = await encryptDirectMessagesForClientStorage({
          directMessages: extractionResult.directMessages,
          passphrase: stagedArchive.dmPassphrase,
          recoveryKey: stagedArchive.dmRecoveryKey,
        })

        setUploadProgressDetail('Uploading encrypted DMs...')
        const encryptedDmUpload = await uploadEncryptedDmPayloadToStaging({
          payload: encryptedDmPayload,
          fileName: `${stagedArchive.fileName.replace(/\\.zip$/i, '') || 'archive'}-encrypted-dms.json`,
        })

        if (!encryptedDmUpload.success) {
          throw new Error(encryptedDmUpload.error)
        }

        encryptedDmStagedInputPath = encryptedDmUpload.stagedInputPath
        dmEncryption = {
          encrypted_input_path: encryptedDmUpload.stagedInputPath,
          conversation_count: encryptedDmPayload.metadata.conversation_count,
          message_count: encryptedDmPayload.metadata.message_count,
          version: encryptedDmPayload.version,
        }
      }

      const result = await startTwitterArchiveImport({
        stagedInputPath: stagedArchive.stagedInputPath,
        fileName: stagedArchive.fileName,
        fileType: stagedArchive.fileType,
        fileSize: stagedArchive.fileSize,
        username: twitterUsername || undefined,
        importSelection: stagedArchive.importSelection,
        dmEncryption,
        preserveArchiveFile: !stagedArchive.storeEncryptedArchive,
      })

      setUploadResult(result)
      if (result.success) {
        if (stagedArchive.storeEncryptedArchive && result.job?.id) {
          encryptedArchiveAutoStartKeyRef.current = null
          setEncryptedArchiveTask({
            jobId: result.job.id,
            backupId: null,
            knownBackupIdsAtQueue: backups.map((backup) => String(backup.id || '')),
            file: stagedArchive.file,
            passphrase: stagedArchive.dmPassphrase,
            recoveryKey: stagedArchive.dmRecoveryKey,
            status: 'waiting_backup',
            progressPercent: 2,
            detail: 'Waiting for import to complete before encrypted ZIP storage starts...',
            error: null,
          })
        } else {
          setEncryptedArchiveTask(null)
        }
        setStagedArchive(null)
        await fetchBackupsSummary()
      }
    } catch (error) {
      console.error('Start import error:', error)
      if (encryptedDmStagedInputPath) {
        await discardStagedArchiveByPath(encryptedDmStagedInputPath)
      }
      setUploadResult({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start archive import',
      })
    } finally {
      setStartingArchiveImport(false)
      setUploadProgressDetail(null)
    }
  }

  const handleStartEncryptedArchiveStorage = useCallback(async () => {
    const task = encryptedArchiveTask
    if (!task || !task.backupId) return

    setEncryptedArchiveTask((prev) =>
      prev
        ? {
            ...prev,
            status: 'running',
            progressPercent: Math.max(4, prev.progressPercent),
            detail: 'Encrypting archive ZIP and uploading chunks...',
            error: null,
          }
        : prev,
    )

    try {
      const result = await encryptAndUploadArchiveInChunks({
        backupId: task.backupId,
        file: task.file,
        passphrase: task.passphrase,
        recoveryKey: task.recoveryKey,
        onProgress: (progress) => {
          setEncryptedArchiveTask((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'running',
                  progressPercent: progress.percent,
                  detail: progress.detail,
                  error: null,
                }
              : prev,
          )
        },
      })

      if (!result.success) {
        setEncryptedArchiveTask((prev) =>
          prev
            ? {
                ...prev,
                status: 'failed',
                detail: 'Encrypted archive storage failed.',
                error: result.error,
              }
            : prev,
        )
        return
      }

      setEncryptedArchiveTask((prev) =>
        prev
          ? {
              ...prev,
              status: 'completed',
              progressPercent: 100,
              detail: 'Encrypted archive stored successfully.',
              error: null,
            }
          : prev,
      )
      await fetchBackupsSummary()
    } catch (error) {
      setEncryptedArchiveTask((prev) =>
        prev
          ? {
              ...prev,
              status: 'failed',
              detail: 'Encrypted archive storage failed.',
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          : prev,
      )
    }
  }, [encryptedArchiveTask, fetchBackupsSummary])

  useEffect(() => {
    setEncryptedArchiveTask((prev) => {
      if (!prev || prev.status !== 'waiting_backup' || prev.backupId) return prev

      const knownBackupIds = new Set(prev.knownBackupIdsAtQueue)
      const matchingJob = jobs.find((job) => job.id === prev.jobId)

      if (matchingJob?.status === 'failed') {
        return {
          ...prev,
          status: 'failed',
          detail: 'Import failed before archive encryption could start.',
          error: matchingJob.error_message || matchingJob.message || 'Archive upload job failed.',
        }
      }

      const fallbackBackup = backups.find((backup) => {
        const backupId = String(backup.id || '')
        if (!backupId || knownBackupIds.has(backupId)) return false
        return true
      })

      const resolvedBackupId =
        (matchingJob?.result_backup_id && matchingJob.result_backup_id.trim()) ||
        (fallbackBackup ? String(fallbackBackup.id) : '')

      if (!resolvedBackupId) return prev

      return {
        ...prev,
        backupId: resolvedBackupId,
        detail: 'Import complete. Starting encrypted ZIP storage...',
        progressPercent: Math.max(prev.progressPercent, 8),
      }
    })
  }, [backups, jobs])

  useEffect(() => {
    if (!encryptedArchiveTask || encryptedArchiveTask.status !== 'waiting_backup' || encryptedArchiveTask.backupId) return
    if (hasActiveJob) return

    const interval = setInterval(() => {
      void fetchBackupsSummary()
    }, 2000)
    return () => clearInterval(interval)
  }, [encryptedArchiveTask, fetchBackupsSummary, hasActiveJob])

  useEffect(() => {
    if (!encryptedArchiveTask || encryptedArchiveTask.status !== 'waiting_backup' || !encryptedArchiveTask.backupId) return
    const autoStartKey = `${encryptedArchiveTask.jobId}:${encryptedArchiveTask.backupId}`
    if (encryptedArchiveAutoStartKeyRef.current === autoStartKey) return
    encryptedArchiveAutoStartKeyRef.current = autoStartKey
    void handleStartEncryptedArchiveStorage()
  }, [encryptedArchiveTask, handleStartEncryptedArchiveStorage])

  const handleDismissEncryptedArchiveStorage = useCallback(() => {
    encryptedArchiveAutoStartKeyRef.current = null
    setEncryptedArchiveTask(null)
  }, [])

  const handleScrapeNow = async (selection: SnapshotSelection) => {
    if (!twitterUsername.trim()) return
    if (!Object.values(selection).some(Boolean)) {
      setScrapeResult({ success: false, error: 'Select at least one data type to scrape.' })
      return
    }

    const targets: TwitterScrapeTargets = {
      profile: selection.tweets || selection.replies || selection.media,
      tweets: selection.tweets || selection.media,
      replies: selection.replies,
      followers: selection.followers,
      following: selection.following,
    }
    const includeMedia = selection.media

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
          includeMedia,
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
    return <ThemeLoadingScreen label="Loading dashboard..." />
  }

  if (!user) return null

  const inProgressJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'processing')
  const activeJobEtaLabel = activeJob ? getJobEtaLabel(activeJob) : null
  const totalBackupPages = Math.max(1, Math.ceil(backups.length / BACKUPS_PAGE_SIZE))
  const currentBackupsPage = Math.min(backupsPage, totalBackupPages)
  const paginatedBackups = backups.slice(
    (currentBackupsPage - 1) * BACKUPS_PAGE_SIZE,
    currentBackupsPage * BACKUPS_PAGE_SIZE,
  )
  const backupPageItems: Array<number | 'ellipsis'> = []
  if (totalBackupPages <= 7) {
    for (let page = 1; page <= totalBackupPages; page += 1) backupPageItems.push(page)
  } else {
    backupPageItems.push(1)
    if (currentBackupsPage > 3) backupPageItems.push('ellipsis')
    const windowStart = Math.max(2, currentBackupsPage - 1)
    const windowEnd = Math.min(totalBackupPages - 1, currentBackupsPage + 1)
    for (let page = windowStart; page <= windowEnd; page += 1) backupPageItems.push(page)
    if (currentBackupsPage < totalBackupPages - 2) backupPageItems.push('ellipsis')
    backupPageItems.push(totalBackupPages)
  }
  const selectedTargetCount = Object.values(snapshotSelection).filter(Boolean).length
  const hasSelectedTargets = selectedTargetCount > 0
  const hasStagedArchive = Boolean(stagedArchive)
  const dmEncryptionRequired = Boolean(stagedArchive?.importSelection.direct_messages || stagedArchive?.storeEncryptedArchive)
  const dmEncryptionReady = Boolean(
    stagedArchive &&
      (!dmEncryptionRequired ||
        (stagedArchive.dmEncryptionEnabled &&
          stagedArchive.dmPassphrase.trim().length >= 8 &&
          stagedArchive.dmPassphrase === stagedArchive.dmPassphraseConfirm &&
          stagedArchive.dmRecoveryKeySaved)),
  )
  const limitTweetsReplies = Math.max(1, Math.floor(scrapeLimits?.maxTweetsAndReplies || 5000))
  const limitFollowersFollowing = Math.max(1, Math.floor(scrapeLimits?.maxFollowersAndFollowing || 50000))
  const storageUsedLabel = formatStorage(storageSummary?.totalBytes)
  const storageLimitLabel = formatStorage(storageSummary?.limitBytes)
  const creditsUsedLabel = formatUsd(apiUsage?.spentUsd)
  const creditsLimitLabel = formatUsd(apiUsage?.limitUsd)
  const activeMode = searchParams.get('tab') === 'scan' ? 'scan' : 'save'

  return (
    <div className="relative min-h-screen bg-neutral-100 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.18),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.25),transparent_50%)]" />
      <div className="relative mx-auto w-full max-w-5xl px-6 pb-20 pt-[calc(1rem+env(safe-area-inset-top))] sm:pb-24 sm:pt-8">
        <button
          type="button"
          onClick={toggleTheme}
          className="fixed right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{isDark ? 'Light' : 'Dark'}</span>
        </button>

        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image
              src="/logo-square.png"
              alt="Social Backup"
              width={80}
              height={80}
              className="h-11 w-11 rounded-xl border border-neutral-200 bg-white/60 p-1 dark:border-white/15 dark:bg-white/5"
            />
            <p className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-white">Social Backup</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-3.5 py-1.5 text-sm text-neutral-800 dark:border-white/15 dark:bg-white/10 dark:text-white/90">
              <span className="max-w-[11rem] truncate">{displayName}</span>
              <UserRound size={15} className="text-neutral-500 dark:text-white/65" />
            </div>
            <button
              onClick={() => {
                void handleSignOut()
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/70 text-neutral-700 transition hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        <div className="mt-6 flex justify-center">
          <AppModeTabs activeMode={activeMode} saveHref="/dashboard" scanHref="/dashboard?tab=scan" />
        </div>

        {activeMode === 'save' ? (
          <>
        <div className="mx-auto mt-10 max-w-3xl text-center sm:mt-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">X (Twitter) backups</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-5xl">X Backups</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300 sm:text-base">Snapshot is the fastest option.</p>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 sm:text-base">Upload archive is available when you need full history.</p>
        </div>

        <div className="mx-auto mt-10 w-full max-w-3xl border-t border-neutral-300/70 dark:border-neutral-800/80" />

        <section className="mx-auto mb-24 mt-10 w-full max-w-3xl text-center">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
            Twitter backup options
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setMode('snapshot')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                mode === 'snapshot'
                  ? 'border border-neutral-900 bg-neutral-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-neutral-900'
                  : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 dark:border-white/20 dark:bg-transparent dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
              }`}
            >
              Take Snapshot
            </button>
            <button
              onClick={() => setMode('upload')}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === 'upload'
                  ? 'border border-neutral-900 bg-neutral-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-neutral-900'
                  : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 dark:border-white/20 dark:bg-transparent dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
              }`}
            >
              Upload Archive
            </button>
          </div>

          <div className="mt-10">
            {mode === 'snapshot' ? (
              <div className="text-center text-neutral-900 dark:text-neutral-100">
                <label htmlFor="dashboard-snapshot-username" className="sr-only">
                  X username
                </label>
                <div className="mx-auto mt-7 flex w-full max-w-md flex-row items-stretch gap-2">
                  <input
                    id="dashboard-snapshot-username"
                    type="text"
                    name="x-handle"
                    value={twitterUsername}
                    onChange={(e) => setTwitterUsername(e.target.value.replace(/^@/, ''))}
                    placeholder="@username"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    disabled={scraping || hasActiveJob}
                    style={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    }}
                    className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-blue-400"
                  />
                  <button
                    onClick={() => {
                      void handleScrapeNow(snapshotSelection)
                    }}
                    disabled={scraping || hasActiveJob || !twitterUsername.trim() || !hasSelectedTargets}
                    className="shrink-0 whitespace-nowrap rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-300"
                  >
                    {scraping ? 'Starting...' : hasActiveJob ? 'Job in progress...' : 'Get Backup'}
                  </button>
                </div>

                {scrapeResult?.success && (
                  <div className="mt-3 flex items-center justify-center gap-1 text-xs text-emerald-600 dark:text-emerald-300">
                    <CheckCircle2 size={14} />
                    Snapshot job started
                  </div>
                )}

                {scrapeResult?.error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{scrapeResult.error}</p>}

                <details className="mt-6 inline-block w-fit rounded-xl border border-neutral-300/80 bg-white/60 px-3 py-2 text-left text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300">
                  <summary className="cursor-pointer select-none font-semibold">Customize download</summary>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                    {([
                      ['tweets', 'Tweets'],
                      ['replies', 'Replies'],
                      ['media', 'Media'],
                      ['followers', 'Followers'],
                      ['following', 'Following'],
                    ] as Array<[keyof SnapshotSelection, string]>).map(([key, label]) => (
                      <label key={key} className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={snapshotSelection[key]}
                          disabled={scraping || hasActiveJob}
                          onChange={(e) =>
                            setSnapshotSelection({
                              ...snapshotSelection,
                              [key]: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </details>

                <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
                  Current limits for free users: up to {limitTweetsReplies.toLocaleString()} tweets + replies combined and{' '}
                  {limitFollowersFollowing.toLocaleString()} followers + following combined.
                </p>
              </div>
            ) : (
              <div className="text-center text-neutral-900 dark:text-neutral-100">
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleFileUpload}
                  disabled={uploading || analyzingArchive || startingArchiveImport || hasActiveJob}
                  className="hidden"
                  id="dashboard-archive-file"
                />
                <label
                  htmlFor="dashboard-archive-file"
                  onDragOver={handleArchiveDragOver}
                  onDragLeave={handleArchiveDragLeave}
                  onDrop={(event) => {
                    void handleArchiveDrop(event)
                  }}
                  className={`mx-auto mt-7 flex w-full max-w-md flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center text-sm font-semibold transition ${
                    uploading || analyzingArchive || startingArchiveImport || hasActiveJob
                      ? 'cursor-not-allowed border-neutral-300 bg-white/60 text-neutral-500 opacity-60 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-400'
                      : isArchiveDragActive
                        ? 'cursor-pointer border-neutral-900 bg-white text-neutral-900 dark:border-neutral-300 dark:bg-neutral-900 dark:text-neutral-100'
                        : 'cursor-pointer border-neutral-300 bg-white/80 text-neutral-700 hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-300 dark:hover:bg-neutral-900'
                  }`}
                >
                  <span>
                    {uploading
                      ? 'Uploading...'
                      : analyzingArchive
                        ? 'Scanning archive...'
                        : isArchiveDragActive
                          ? 'Drop ZIP to upload'
                          : 'Upload your X archive ZIP'}
                  </span>
                  {!uploading && !analyzingArchive && !startingArchiveImport && !hasActiveJob && (
                    <span className="mt-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                      {hasStagedArchive ? 'Click to choose a different ZIP, or drag and drop.' : 'Click to choose a ZIP, or drag and drop.'}
                    </span>
                  )}
                </label>
                <p className="mt-6 text-xs text-neutral-500 dark:text-neutral-400">
                  Use this for a deeper history import based on the official X archive file.
                </p>
                <a
                  href="https://twitter.com/settings/download_your_data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300"
                >
                  Request from X here
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                <details className="mx-auto mt-8 block w-fit rounded-xl border border-neutral-300/80 bg-white/60 px-3 py-2 text-left text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300">
                  <summary className="cursor-pointer select-none text-center font-semibold">Security & encryption</summary>
                  <div className="mt-2 space-y-1 text-center">
                    <p>Archive uploads stay private to your account and are not publicly listed.</p>
                    <p>Optional passphrase encryption is available for DMs and original archive ZIP storage.</p>
                    <p>When encryption is enabled, save your recovery key. It is required for recovery workflows.</p>
                  </div>
                </details>

                {(uploading || analyzingArchive) && (
                  <div className="mx-auto mt-4 max-w-md rounded-xl border border-neutral-300 bg-neutral-50/90 p-3 text-left dark:border-white/15 dark:bg-white/5">
                    <div className="flex items-center justify-between text-xs text-neutral-700 dark:text-neutral-300">
                      <span>{uploadProgressDetail || 'Processing archive...'}</span>
                      {uploading ? <span>{Math.round(Math.max(0, Math.min(100, uploadProgressPercent)))}%</span> : <span>Scanning</span>}
                    </div>
                    {uploading && (
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/15">
                        <div
                          className="h-full rounded-full bg-neutral-900 dark:bg-white"
                          style={{ width: `${Math.round(Math.max(0, Math.min(100, uploadProgressPercent)))}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {stagedArchive && (
                  <div className="mx-auto mt-4 max-w-xl rounded-xl border border-neutral-300 bg-white/90 p-4 text-left dark:border-white/12 dark:bg-neutral-900/70">
                    <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{stagedArchive.fileName}</p>
                    <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{summarizeArchivePreview(stagedArchive.preview)}</p>

                    <details className="mt-3 rounded-lg border border-neutral-300 bg-white/60 p-3 text-left dark:border-white/10 dark:bg-white/5">
                      <summary className="cursor-pointer text-xs font-semibold text-neutral-700 dark:text-neutral-300">Customize import</summary>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {([
                          ['tweets', 'Tweets'],
                          ['followers', 'Followers'],
                          ['following', 'Following'],
                          ['likes', 'Likes'],
                          ['media', 'Media'],
                        ] as Array<[keyof ArchiveImportSelection, string]>).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                            <input
                              type="checkbox"
                              checked={stagedArchive.importSelection[key]}
                              disabled={!stagedArchive.preview.available[key] || hasActiveJob || startingArchiveImport}
                              onChange={(e) => handleArchiveSelectionChange(key, e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-white/30 bg-transparent"
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </details>

                    <div className="mt-3 rounded-lg border border-neutral-300 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
                      <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Encryption options</p>
                      <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        Optional: encrypt DMs now, and optionally store an encrypted version of the original ZIP.
                      </p>

                      <div className="mt-3 space-y-2">
                        <label className="flex items-center justify-between gap-3 text-xs text-neutral-700 dark:text-neutral-300">
                          <span>Include DMs (encrypted)</span>
                          <input
                            type="checkbox"
                            checked={stagedArchive.importSelection.direct_messages}
                            disabled={!stagedArchive.preview.available.direct_messages || startingArchiveImport || hasActiveJob}
                            onChange={(e) => handleIncludeEncryptedDmsChange(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-white/30 bg-transparent"
                          />
                        </label>

                        <label className="flex items-center justify-between gap-3 text-xs text-neutral-700 dark:text-neutral-300">
                          <span>Encrypt original archive ZIP</span>
                          <input
                            type="checkbox"
                            checked={stagedArchive.storeEncryptedArchive}
                            disabled={startingArchiveImport || hasActiveJob}
                            onChange={(e) => handleStoreEncryptedArchiveChange(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-white/30 bg-transparent"
                          />
                        </label>

                        {(stagedArchive.dmEncryptionEnabled || stagedArchive.storeEncryptedArchive) && (
                          <div className="space-y-2 rounded-lg border border-neutral-300 bg-white p-2.5 dark:border-white/10 dark:bg-neutral-950/60">
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                              Set one passphrase for encrypted DMs and/or encrypted archive ZIP.
                            </p>
                            <input
                              type="password"
                              value={stagedArchive.dmPassphrase}
                              onChange={(e) => handleDmPassphraseChange(e.target.value)}
                              placeholder="Passphrase (min 8 chars)"
                              disabled={startingArchiveImport || hasActiveJob}
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-white/20 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-white/60"
                            />
                            <input
                              type="password"
                              value={stagedArchive.dmPassphraseConfirm}
                              onChange={(e) => handleDmPassphraseConfirmChange(e.target.value)}
                              placeholder="Confirm passphrase"
                              disabled={startingArchiveImport || hasActiveJob}
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-white/20 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-white/60"
                            />
                            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-2 dark:border-white/10 dark:bg-black/25">
                              <p className="text-[10px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">Recovery key</p>
                              <p className="mt-1 break-all font-mono text-xs text-neutral-700 dark:text-neutral-200">{stagedArchive.dmRecoveryKey}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleCopyRecoveryKey()}
                                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-white/20 dark:bg-white/5 dark:text-white/85 dark:hover:bg-white/10"
                                >
                                  {recoveryKeyCopied ? 'Copied' : 'Copy'}
                                </button>
                                <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300">
                                  <input
                                    type="checkbox"
                                    checked={stagedArchive.dmRecoveryKeySaved}
                                    onChange={(e) => handleDmRecoverySavedChange(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-white/30 bg-transparent"
                                  />
                                  I saved it
                                </label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handleStartArchiveImport()
                        }}
                        disabled={startingArchiveImport || hasActiveJob || !dmEncryptionReady}
                        className="inline-flex rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-300"
                      >
                        {startingArchiveImport ? 'Starting import...' : hasActiveJob ? 'Job in progress...' : 'Start import'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDiscardStagedArchive()
                        }}
                        disabled={startingArchiveImport || hasActiveJob}
                        className="inline-flex rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-white/5 dark:text-white/85 dark:hover:bg-white/10"
                      >
                        Remove
                      </button>
                    </div>
                    {dmEncryptionRequired && !dmEncryptionReady && (
                      <p className="mt-2 text-xs text-amber-300">
                        Finish passphrase setup and confirm recovery key before importing DMs.
                      </p>
                    )}
                  </div>
                )}

                {uploadResult && (
                  <p
                    className={`mx-auto mt-4 max-w-xl text-sm ${
                      uploadResult.success ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {uploadResult.success ? uploadResult.message : uploadResult.error}
                  </p>
                )}
              </div>
            )}
          </div>

          {activeJob && (
            <div className="mx-auto mt-4 w-full max-w-2xl rounded-xl border border-neutral-300 bg-neutral-50/90 p-3 dark:border-white/15 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {activeJob.job_type === 'archive_upload' ? 'Archive import running' : 'Snapshot running'}
                  </p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300">{activeJob.message || 'Processing your request...'}</p>
                  <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    ETA: {activeJobEtaLabel ? `~${activeJobEtaLabel}` : 'calculating...'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setCancellingJobId(activeJob.id)
                    try {
                      await handleCancelJob(activeJob.id)
                    } catch (error) {
                      console.error('Cancel job error:', error)
                      alert(error instanceof Error ? error.message : 'Failed to cancel job.')
                    } finally {
                      setCancellingJobId(null)
                    }
                  }}
                  disabled={cancellingJobId === activeJob.id}
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/25 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
                >
                  {cancellingJobId === activeJob.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  {cancellingJobId === activeJob.id ? 'Cancelling' : 'Cancel'}
                </button>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/15">
                <div
                  className="h-full rounded-full bg-neutral-900 dark:bg-white"
                  style={{ width: `${normalizeJobProgress(activeJob.progress)}%` }}
                />
              </div>
            </div>
          )}

          {activeJob && (
            <p className="mx-auto mt-2 w-full max-w-2xl text-center text-[11px] text-neutral-500 dark:text-neutral-400">
              You can close this tab and come back later. This job will continue in the background.
            </p>
          )}

          {!activeJob && completedJobNotice && (
            <div className="mx-auto mt-4 w-full max-w-2xl rounded-xl border border-emerald-300 bg-emerald-50/90 p-3 text-center dark:border-emerald-500/35 dark:bg-emerald-500/10">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={15} />
                {completedJobNotice.message}
              </p>
            </div>
          )}

          {encryptedArchiveTask && (
            <div className="mx-auto mt-3 w-full max-w-2xl rounded-xl border border-neutral-300 bg-neutral-50/90 p-3 dark:border-white/15 dark:bg-white/5">
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">Encrypted archive</p>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
                {encryptedArchiveTask.detail ||
                  (encryptedArchiveTask.status === 'running'
                    ? 'Encrypting your archive in the background...'
                    : encryptedArchiveTask.status === 'completed'
                      ? 'Encrypted archive is ready.'
                      : encryptedArchiveTask.status === 'failed'
                        ? 'Encrypted archive failed.'
                        : 'Queued after import completion.')}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/15">
                <div
                  className={`h-full rounded-full ${
                    encryptedArchiveTask.status === 'failed'
                      ? 'bg-rose-400'
                      : encryptedArchiveTask.status === 'completed'
                        ? 'bg-emerald-400'
                        : 'bg-neutral-900 dark:bg-white'
                  }`}
                  style={{ width: `${Math.max(3, Math.min(100, Math.round(encryptedArchiveTask.progressPercent || 0)))}%` }}
                />
              </div>
              {encryptedArchiveTask.error && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{encryptedArchiveTask.error}</p>
              )}
              {(encryptedArchiveTask.status === 'completed' || encryptedArchiveTask.status === 'failed') && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleDismissEncryptedArchiveStorage}
                    className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="mx-auto mt-12 w-full max-w-3xl border-t border-neutral-300/70 dark:border-neutral-800/80" />

        <section className="mx-auto mt-8 w-full max-w-md">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-neutral-200 bg-white/70 p-2.5 text-center dark:border-white/10 dark:bg-neutral-900/65">
            <div className="rounded-xl border border-neutral-200 bg-white/75 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">Storage</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
                {storageUsedLabel} / {storageLimitLabel}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white/75 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">Credits</p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
                {creditsUsedLabel} / {creditsLimitLabel}
              </p>
            </div>
          </div>
        </section>

        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-20 rounded-2xl border border-neutral-200 bg-white/85 px-3 py-2.5 shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-white/15 dark:bg-neutral-900/85">
          <p className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-200">Want Instagram or TikTok next?</p>
          <div className="mt-2 flex items-center gap-1.5">
            {([
              ['instagram', 'Instagram'],
              ['tiktok', 'TikTok'],
            ] as const).map(([platform, label]) => (
              <button
                key={platform}
                onClick={() => {
                  void handlePlatformVote(platform)
                }}
                disabled={platformVotes[platform] === 'saving' || platformVotes[platform] === 'saved'}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
              >
                {platformVotes[platform] === 'saving'
                  ? 'Saving...'
                  : platformVotes[platform] === 'saved'
                    ? `${label} ✓`
                    : platformVotes[platform] === 'error'
                      ? 'Retry'
                      : label}
              </button>
            ))}
          </div>
        </div>

        <section className="mx-auto mt-8 w-full max-w-3xl">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Backups</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {backups.length} total
            </p>
          </div>

          <div className="mt-4 space-y-2.5">
            {loadingBackups ? (
              <div className="rounded-2xl border border-neutral-200 bg-white/75 p-4 text-sm text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
                Loading activity...
              </div>
            ) : inProgressJobs.length === 0 && paginatedBackups.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-white/75 p-4 text-sm text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
                No activity yet. Start with a snapshot, or use upload archive for full history.
              </div>
            ) : (
              <>
                {inProgressJobs.map((job) => {
                  const etaLabel = getJobEtaLabel(job)

                  return (
                    <article
                      key={job.id}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-neutral-900/75"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-200">
                        <RefreshCw size={16} className="animate-spin" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-neutral-900 dark:text-white">
                          {job.job_type === 'archive_upload' ? 'Archive import in progress' : 'Snapshot in progress'}
                        </p>
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{job.message || 'Running...'}</p>
                        <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                          ETA: {etaLabel ? `~${etaLabel}` : 'calculating...'}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          setCancellingJobId(job.id)
                          try {
                            await handleCancelJob(job.id)
                          } catch (error) {
                            console.error('Cancel job error:', error)
                            alert(error instanceof Error ? error.message : 'Failed to cancel job.')
                          } finally {
                            setCancellingJobId(null)
                          }
                        }}
                        disabled={cancellingJobId === job.id}
                        className="inline-flex h-9 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
                      >
                        {cancellingJobId === job.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    </article>
                  )
                })}

                {paginatedBackups.map((backup) => {
                  const partial = getBackupPartialDetails(backup)
                  const isArchive = isArchiveBackup(backup)
                  const hasEncryptedArchive = Boolean(backup.data?.encrypted_archive)
                  const archiveFilePath =
                    typeof backup.data?.archive_file_path === 'string' ? backup.data.archive_file_path.trim() : ''
                  const canDownloadArchive = isArchive && !hasEncryptedArchive && archiveFilePath.length > 0
                  const methodLabel = backup.backup_name || formatBackupMethodLabel(backup)
                  const platformUsername = backup.data?.profile?.username ? `@${backup.data.profile.username}` : ''
                  const partialTitle =
                    partial.reasons.length > 0
                      ? partial.reasons.map((reason) => formatPartialReasonLabel(reason)).join(' • ')
                      : 'This snapshot did not complete all requested data.'

                  return (
                    <article
                      key={backup.id}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-neutral-900/75"
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          isArchive
                            ? 'bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-200'
                            : 'bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-200'
                        }`}
                      >
                        {isArchive ? <Archive size={16} /> : <CloudUpload size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[15px] font-semibold text-neutral-900 dark:text-white">{methodLabel}</p>
                          {platformUsername && <span className="text-xs text-neutral-500 dark:text-neutral-400">{platformUsername}</span>}
                          {partial.isPartial && (
                            <span
                              title={partialTitle}
                              className="inline-flex rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                            >
                              Partial
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {formatDate(backup.uploaded_at || backup.created_at)} • {formatSize(resolveBackupSize(backup))}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {canDownloadArchive && (
                          <button
                            onClick={() => {
                              void handleDownloadBackup(backup.id)
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 transition hover:bg-neutral-100 dark:border-white/15 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
                            aria-label="Download"
                            title="Download archive"
                          >
                            <Download size={15} />
                          </button>
                        )}
                        <a
                          href={`/dashboard/backup/${backup.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 transition hover:bg-neutral-100 dark:border-white/15 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
                          aria-label="Open"
                          title="Open backup"
                        >
                          <Eye size={15} />
                        </a>
                        <button
                          onClick={() => {
                            setDeleteConfirmTarget({
                              id: backup.id,
                              label: platformUsername || methodLabel,
                            })
                          }}
                          disabled={deletingBackupId === backup.id}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
                          aria-label="Delete backup"
                          title="Delete backup"
                        >
                          {deletingBackupId === backup.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </>
            )}
          </div>

          {!loadingBackups && totalBackupPages > 1 && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setBackupsPage(Math.max(1, currentBackupsPage - 1))}
                disabled={currentBackupsPage === 1}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
              >
                Prev
              </button>
              {backupPageItems.map((item, index) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${index}`} className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
                    ...
                  </span>
                ) : (
                  <button
                    key={`page-${item}`}
                    type="button"
                    onClick={() => setBackupsPage(item)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      item === currentBackupsPage
                        ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                        : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10'
                    }`}
                  >
                    {item}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => setBackupsPage(Math.min(totalBackupPages, currentBackupsPage + 1))}
                disabled={currentBackupsPage === totalBackupPages}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
              >
                Next
              </button>
            </div>
          )}
        </section>

        <footer className="mt-10 text-center text-xs text-neutral-500 dark:text-neutral-400">© {new Date().getFullYear()} Social Backup</footer>
          </>
        ) : (
          <section className="mx-auto mt-10 w-full max-w-3xl">
            <ScanComingSoonPanel />
          </section>
        )}
      </div>

      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-300 bg-white p-5 shadow-xl dark:border-white/15 dark:bg-neutral-900">
            <p className="text-base font-semibold text-neutral-900 dark:text-white">Delete backup?</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">This cannot be undone.</p>
            <p className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">{deleteConfirmTarget.label}</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                disabled={deletingBackupId === deleteConfirmTarget.id}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteBackup(deleteConfirmTarget.id)
                }}
                disabled={deletingBackupId === deleteConfirmTarget.id}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/35 dark:bg-rose-500/80 dark:hover:bg-rose-500"
              >
                {deletingBackupId === deleteConfirmTarget.id ? <Loader2 size={14} className="animate-spin" /> : null}
                {deletingBackupId === deleteConfirmTarget.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
