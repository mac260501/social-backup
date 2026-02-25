import { createAdminClient } from '@/lib/supabase/admin'
import {
  getBackupJobForUser,
  isBackupJobCancellationRequested,
  markBackupJobCompleted,
  markBackupJobCleanup,
  markBackupJobFailed,
  markBackupJobProcessing,
  markBackupJobProgress,
  mergeBackupJobPayload,
} from '@/lib/jobs/backup-jobs'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'
import { resolveConfiguredAppBaseUrl, sendBackupReadyEmail } from '@/lib/notifications/backup-ready-email'
import { recalculateAndPersistBackupStorage } from '@/lib/storage/usage'
import { getTwitterProvider } from '@/lib/twitter/twitter-service'
import type { Tweet, TwitterScrapeTargets } from '@/lib/twitter/types'
import { roundUsd } from '@/lib/twitter/apify-pricing'
import { buildInternalMediaUrl } from '@/lib/storage/media-url'
import { uploadObjectToR2 } from '@/lib/storage/r2'

const supabase = createAdminClient()

const OPTIONAL_MEDIA_FILE_COLUMNS = new Set([
  'file_name',
  'file_size',
  'mime_type',
  'media_type',
  'tweet_id',
])
const DEFAULT_MEDIA_WORKER_COUNT = 6
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function resolveMediaWorkerCount(): number {
  const raw = process.env.TWITTER_SCRAPE_MEDIA_WORKERS
  if (!raw) return DEFAULT_MEDIA_WORKER_COUNT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MEDIA_WORKER_COUNT
  return Math.max(1, Math.min(16, parsed))
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

type SnapshotLiveMetrics = {
  phase: string
  tweets_fetched: number
  replies_fetched: number
  followers_fetched: number
  following_fetched: number
  media_processed: number
  media_total: number
  api_cost_usd: number
}

type SnapshotApifyRuns = {
  timeline_run_id: string | null
  social_graph_run_id: string | null
}

class JobCancelledError extends Error {
  constructor(message: string = 'Job cancelled by user') {
    super(message)
    this.name = 'JobCancelledError'
  }
}

function isCancellationError(error: unknown): boolean {
  if (error instanceof JobCancelledError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return error.name === 'RunCancelledError' || message.includes('cancelled by user') || message.includes('cancellation requested')
}

function buildLiveMessage(metrics: SnapshotLiveMetrics): string {
  const phaseLabel = metrics.phase || 'running'
  return `In progress (${phaseLabel})`
}

function progressForSnapshotPhase(phase: string, mediaProcessed: number, mediaTotal: number): number {
  if (phase === 'preparing') return 8
  if (phase === 'scraping') return 20
  if (phase === 'saving') return 60
  if (phase === 'media') {
    if (mediaTotal <= 0) return 72
    const ratio = Math.max(0, Math.min(1, mediaProcessed / mediaTotal))
    return 72 + Math.round(ratio * 20)
  }
  if (phase === 'finalizing') return 94
  return 25
}

async function ensureSnapshotJobNotCancelled(jobId: string): Promise<void> {
  const cancelRequested = await isBackupJobCancellationRequested(supabase, jobId)
  if (cancelRequested) {
    throw new JobCancelledError()
  }
}

function parseMissingColumnName(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error || error.code !== 'PGRST204' || typeof error.message !== 'string') return null
  const match = error.message.match(/'([^']+)' column of 'media_files'/)
  return match?.[1] || null
}

async function insertMediaFileRecord(payload: Record<string, unknown>) {
  const nextPayload = { ...payload }
  const maxRetries = OPTIONAL_MEDIA_FILE_COLUMNS.size
  let attempt = 0

  while (attempt <= maxRetries) {
    const { error } = await supabase.from('media_files').insert(nextPayload)
    if (!error) return null

    const missingColumn = parseMissingColumnName(error)
    if (!missingColumn || !OPTIONAL_MEDIA_FILE_COLUMNS.has(missingColumn)) {
      return error
    }

    if (!(missingColumn in nextPayload)) {
      return error
    }

    delete nextPayload[missingColumn]
    attempt += 1
  }

  return new Error('Failed to insert media_files record after removing optional columns.')
}

async function processScrapedProfileMedia(
  userId: string,
  backupId: string,
  profileImageUrl: string | undefined,
  coverImageUrl: string | undefined,
  onMediaProcessed?: () => Promise<void>,
  ensureActive?: () => Promise<void>,
) {
  if (!profileImageUrl && !coverImageUrl) return

  const uploadImage = async (sourceUrl: string, filename: string): Promise<string | null> => {
    try {
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        console.error(`[Profile Media] Failed to download ${sourceUrl}: ${response.statusText}`)
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const contentType = response.headers.get('content-type') || 'image/jpeg'

      const storagePath = `${userId}/profile_media/${backupId}/${filename}`
      await uploadObjectToR2({
        key: storagePath,
        body: buffer,
        contentType,
        upsert: true,
      })

      const { data: existing } = await supabase
        .from('media_files')
        .select('id')
        .eq('backup_id', backupId)
        .eq('file_path', storagePath)
        .maybeSingle()

      if (!existing) {
        const insertError = await insertMediaFileRecord({
          user_id: userId,
          backup_id: backupId,
          file_path: storagePath,
          file_name: filename,
          file_size: buffer.length,
          mime_type: contentType,
          media_type: 'profile_media',
        })
        if (insertError) {
          console.error(`[Profile Media] DB insert error for ${filename}:`, insertError)
        }
      }

      return storagePath
    } catch (err) {
      console.error(`[Profile Media] Error processing ${filename}:`, err)
      return null
    }
  }

  let profileStoragePath: string | null = null
  let coverStoragePath: string | null = null

  const uploads: Array<Promise<void>> = []
  if (profileImageUrl) {
    uploads.push((async () => {
      if (ensureActive) await ensureActive()
      profileStoragePath = await uploadImage(profileImageUrl, 'profile_photo_400x400.jpg')
      if (onMediaProcessed) await onMediaProcessed()
    })())
  }
  if (coverImageUrl) {
    uploads.push((async () => {
      if (ensureActive) await ensureActive()
      coverStoragePath = await uploadImage(coverImageUrl, 'cover_photo.jpg')
      if (onMediaProcessed) await onMediaProcessed()
    })())
  }
  await Promise.all(uploads)

  if (profileStoragePath || coverStoragePath) {
    const { data: backup } = await supabase.from('backups').select('data').eq('id', backupId).single()

    if (backup) {
      const updatedProfile = {
        ...(backup.data?.profile || {}),
        ...(profileStoragePath ? { profileImageUrl: profileStoragePath } : {}),
        ...(coverStoragePath ? { coverImageUrl: coverStoragePath } : {}),
      }

      await supabase
        .from('backups')
        .update({
          data: {
            ...backup.data,
            profile: updatedProfile,
          },
        })
        .eq('id', backupId)
    }
  }
}

async function processScrapedMedia(
  userId: string,
  backupId: string,
  tweetsWithMedia: Tweet[],
  onMediaProcessed?: () => Promise<void>,
  ensureActive?: () => Promise<void>,
) {
  let processedCount = 0
  let errorCount = 0
  const queuedMedia: Array<{
    tweetId: string
    media: NonNullable<Tweet['media']>[number]
  }> = []

  for (const tweet of tweetsWithMedia) {
    if (!tweet.media || tweet.media.length === 0) continue
    for (const media of tweet.media) {
      queuedMedia.push({
        tweetId: tweet.id,
        media,
      })
    }
  }

  const totalCount = queuedMedia.length
  if (totalCount === 0) {
    console.log('[Scraped Media] Complete: 0 processed, 0 errors, 0 total')
    return
  }

  const seenStoragePaths = new Set<string>()
  const workerCount = Math.min(resolveMediaWorkerCount(), totalCount)
  let nextIndex = 0

  const getNextMedia = () => {
    if (nextIndex >= totalCount) return null
    const index = nextIndex
    nextIndex += 1
    return {
      index,
      item: queuedMedia[index],
    }
  }

  const processSingleMedia = async (
    tweetId: string,
    media: NonNullable<Tweet['media']>[number],
    itemIndex: number,
  ) => {
    if (ensureActive && itemIndex % 4 === 0) {
      await ensureActive()
    }

    try {
      if (!media.media_url) {
        return
      }

      const response = await fetch(media.media_url)
      if (!response.ok) {
        errorCount++
        return
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const urlParts = media.media_url.split('/')
      const filename = urlParts[urlParts.length - 1] || `${tweetId}-${media.type}`

      const mimeType = media.type === 'photo' ? 'image/jpeg' : media.type === 'video' ? 'video/mp4' : 'image/gif'
      const storagePath = `${userId}/scraped_media/${filename}`
      await uploadObjectToR2({
        key: storagePath,
        body: buffer,
        contentType: mimeType,
        upsert: true,
      })

      if (!seenStoragePaths.has(storagePath)) {
        seenStoragePaths.add(storagePath)
        const metadataRecord = {
          user_id: userId,
          backup_id: backupId,
          file_path: storagePath,
          file_name: filename,
          file_size: buffer.length,
          mime_type: mimeType,
          media_type: 'scraped_media',
          tweet_id: tweetId,
        }

        const { data: existing } = await supabase
          .from('media_files')
          .select('id')
          .eq('backup_id', backupId)
          .eq('file_path', storagePath)
          .maybeSingle()

        if (!existing) {
          const insertError = await insertMediaFileRecord(metadataRecord)
          if (insertError) {
            console.error(`[Scraped Media] DB insert error for ${filename}:`, insertError)
            errorCount++
            return
          }
        }
      }

      const internalUrl = buildInternalMediaUrl(storagePath)
      media.media_url = internalUrl
      media.media_url_https = internalUrl
      processedCount++
    } catch (error) {
      console.error('[Scraped Media] Error processing media:', error)
      errorCount++
    } finally {
      if (onMediaProcessed) await onMediaProcessed()
    }
  }

  const worker = async () => {
    while (true) {
      const next = getNextMedia()
      if (!next) return
      await processSingleMedia(next.item.tweetId, next.item.media, next.index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  console.log(`[Scraped Media] Complete: ${processedCount} processed, ${errorCount} errors, ${totalCount} total`)
}

export async function processSnapshotScrapeJob(params: {
  jobId: string
  userId: string
  username: string
  tweetsToScrape: number
  targets: TwitterScrapeTargets
  includeMedia?: boolean
  retention?: {
    mode: 'account' | 'guest_30d'
    expiresAtIso: string | null
  }
  socialGraphMaxItems?: number
  apifyWebhook?: {
    baseUrl: string
    token?: string
  }
  apiBudget: {
    monthlySpentBeforeRunUsd: number
    monthlyLimitUsd: number
    monthlyRemainingUsd: number
    perRunLimitUsd: number
    effectiveRunBudgetUsd: number
    estimatedTimelineCostUsd: number
    estimatedSocialGraphCostUsd: number
    estimatedMaxRunCostUsd: number
  }
}) {
  const { jobId, userId, username, tweetsToScrape, targets, includeMedia, retention, socialGraphMaxItems, apifyWebhook, apiBudget } = params
  const shouldIncludeMedia = includeMedia !== false
  let backupId: string | null = null
  const apifyRuns: SnapshotApifyRuns = {
    timeline_run_id: null,
    social_graph_run_id: null,
  }
  const liveMetrics: SnapshotLiveMetrics = {
    phase: 'queued',
    tweets_fetched: 0,
    replies_fetched: 0,
    followers_fetched: 0,
    following_fetched: 0,
    media_processed: 0,
    media_total: 0,
    api_cost_usd: 0,
  }

  const LIVE_SOCIAL_STEP = 50
  const LIVE_TIMELINE_STEP = 10
  const LIVE_MEDIA_STEP = 25
  const LIVE_METRIC_MIN_PERSIST_MS = 500
  const LIVE_METRIC_MAX_SILENCE_MS = 1500
  let lastPersistedMetrics: SnapshotLiveMetrics = { ...liveMetrics }
  let lastPersistedAt = 0

  const shouldPersistLiveMetrics = (nextMetrics: SnapshotLiveMetrics, force: boolean) => {
    if (force) return true
    if (nextMetrics.phase !== lastPersistedMetrics.phase) return true

    const now = Date.now()
    const timelineMoved =
      Math.abs(nextMetrics.tweets_fetched - lastPersistedMetrics.tweets_fetched) >= LIVE_TIMELINE_STEP ||
      Math.abs(nextMetrics.replies_fetched - lastPersistedMetrics.replies_fetched) >= LIVE_TIMELINE_STEP
    const socialMoved =
      Math.abs(nextMetrics.followers_fetched - lastPersistedMetrics.followers_fetched) >= LIVE_SOCIAL_STEP ||
      Math.abs(nextMetrics.following_fetched - lastPersistedMetrics.following_fetched) >= LIVE_SOCIAL_STEP
    const mediaMoved =
      Math.abs(nextMetrics.media_processed - lastPersistedMetrics.media_processed) >= LIVE_MEDIA_STEP ||
      Math.abs(nextMetrics.media_total - lastPersistedMetrics.media_total) >= LIVE_MEDIA_STEP
    const firstNonZeroSnapshot =
      (lastPersistedMetrics.tweets_fetched === 0 && nextMetrics.tweets_fetched > 0) ||
      (lastPersistedMetrics.replies_fetched === 0 && nextMetrics.replies_fetched > 0) ||
      (lastPersistedMetrics.followers_fetched === 0 && nextMetrics.followers_fetched > 0) ||
      (lastPersistedMetrics.following_fetched === 0 && nextMetrics.following_fetched > 0)

    const crossedStep = timelineMoved || socialMoved || mediaMoved || firstNonZeroSnapshot
    if (crossedStep && now - lastPersistedAt >= LIVE_METRIC_MIN_PERSIST_MS) return true
    if (Math.abs(nextMetrics.api_cost_usd - lastPersistedMetrics.api_cost_usd) >= 0.01) return true

    return now - lastPersistedAt >= LIVE_METRIC_MAX_SILENCE_MS
  }

  const syncLiveMetrics = async (patch: Partial<SnapshotLiveMetrics>, options?: { force?: boolean }) => {
    Object.assign(liveMetrics, patch)
    liveMetrics.api_cost_usd = roundUsd(liveMetrics.api_cost_usd || 0)
    const force = options?.force === true
    if (!shouldPersistLiveMetrics(liveMetrics, force)) {
      return
    }
    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: liveMetrics.phase,
      live_metrics: liveMetrics,
      partial_backup_id: backupId,
      apify_runs: apifyRuns,
    })
    await markBackupJobProgress(
      supabase,
      jobId,
      progressForSnapshotPhase(liveMetrics.phase, liveMetrics.media_processed, liveMetrics.media_total),
      buildLiveMessage(liveMetrics),
    )
    lastPersistedMetrics = { ...liveMetrics }
    lastPersistedAt = Date.now()
  }

  try {
    await markBackupJobProcessing(supabase, jobId, 8, 'In progress')
    await syncLiveMetrics({ phase: 'preparing' })
    await ensureSnapshotJobNotCancelled(jobId)

    const twitter = getTwitterProvider()
    if (!twitter.isConfigured()) {
      throw new Error(`${twitter.getProviderName()} is not configured. Please set up API keys.`)
    }

    await syncLiveMetrics({ phase: 'scraping' })
    await ensureSnapshotJobNotCancelled(jobId)

    const result = await twitter.scrapeAll(username, tweetsToScrape, {
      targets,
      socialGraphMaxItems,
      shouldCancel: async () => isBackupJobCancellationRequested(supabase, jobId),
      apifyWebhook: apifyWebhook
        ? {
            ...apifyWebhook,
            jobId,
          }
        : undefined,
      onProgress: async (progress) => {
        await ensureSnapshotJobNotCancelled(jobId)
        let forceSync = false
        if (typeof progress.timeline_run_id === 'string' && progress.timeline_run_id.trim().length > 0) {
          if (apifyRuns.timeline_run_id !== progress.timeline_run_id) {
            apifyRuns.timeline_run_id = progress.timeline_run_id
            forceSync = true
          }
        }
        if (typeof progress.social_graph_run_id === 'string' && progress.social_graph_run_id.trim().length > 0) {
          if (apifyRuns.social_graph_run_id !== progress.social_graph_run_id) {
            apifyRuns.social_graph_run_id = progress.social_graph_run_id
            forceSync = true
          }
        }
        await syncLiveMetrics(
          {
            phase: progress.phase,
            tweets_fetched: progress.tweets_fetched,
            replies_fetched: progress.replies_fetched,
            followers_fetched: progress.followers_fetched,
            following_fetched: progress.following_fetched,
            api_cost_usd: progress.api_cost_usd,
          },
          { force: forceSync },
        )
      },
    })
    await ensureSnapshotJobNotCancelled(jobId)

    const timelineItems = [...result.tweets, ...result.replies]
    const timelineItemsWithMedia = timelineItems.filter((t) => t.media && t.media.length > 0)
    const tweetMediaCount = timelineItemsWithMedia.reduce((sum, t) => sum + (t.media?.length || 0), 0)
    const scrapedFollowersCount = result.followers.length
    const scrapedFollowingCount = result.following.length
    const profileFollowersCount = result.metadata.profileFollowersCount || 0
    const profileFollowingCount = result.metadata.profileFollowingCount || 0
    const followersDisplayCount = Math.max(scrapedFollowersCount, profileFollowersCount)
    const followingDisplayCount = Math.max(scrapedFollowingCount, profileFollowingCount)
    const profileMediaCount = shouldIncludeMedia && targets.profile
      ? (result.metadata.profileImageUrl ? 1 : 0) + (result.metadata.coverImageUrl ? 1 : 0)
      : 0
    const totalMediaCount = shouldIncludeMedia ? tweetMediaCount + profileMediaCount : 0

    await syncLiveMetrics({
      phase: 'saving',
      tweets_fetched: result.tweets.length,
      replies_fetched: result.replies.length,
      followers_fetched: scrapedFollowersCount,
      following_fetched: scrapedFollowingCount,
      media_total: totalMediaCount,
      api_cost_usd: result.cost.total_cost,
    })
    await ensureSnapshotJobNotCancelled(jobId)

    const backupSnapshot = {
      user_id: userId,
      backup_type: 'snapshot',
      source: 'scrape',
      data: {
        tweets: result.tweets,
        replies: result.replies,
        followers: result.followers,
        following: result.following,
        likes: [],
        direct_messages: [],
        profile: {
          username: result.metadata.username,
          displayName: result.metadata.displayName,
          description: result.metadata.profileBio,
          bio: result.metadata.profileBio,
          profileImageUrl: result.metadata.profileImageUrl,
          coverImageUrl: result.metadata.coverImageUrl,
          followersCount: result.metadata.profileFollowersCount,
          followingCount: result.metadata.profileFollowingCount,
          statusesCount: result.metadata.profileStatusesCount,
        },
        stats: {
          tweets: result.tweets.length,
          replies: result.replies.length,
          followers: followersDisplayCount,
          following: followingDisplayCount,
          likes: 0,
          dms: 0,
          media_files: totalMediaCount,
        },
        scrape: {
          provider: result.cost.provider,
          total_cost: result.cost.total_cost,
          scraped_at: result.metadata.scraped_at,
          is_partial: result.metadata.is_partial,
          partial_reasons: result.metadata.partial_reasons || [],
          timeline_limit_hit: Boolean(result.metadata.timeline_limit_hit),
          social_graph_limit_hit: Boolean(result.metadata.social_graph_limit_hit),
          targets,
          budget: {
            monthly_spent_before_run_usd: apiBudget.monthlySpentBeforeRunUsd,
            monthly_limit_usd: apiBudget.monthlyLimitUsd,
            monthly_remaining_before_run_usd: apiBudget.monthlyRemainingUsd,
            per_run_limit_usd: apiBudget.perRunLimitUsd,
            effective_run_budget_usd: apiBudget.effectiveRunBudgetUsd,
            estimated_timeline_cost_usd: apiBudget.estimatedTimelineCostUsd,
            estimated_social_graph_cost_usd: apiBudget.estimatedSocialGraphCostUsd,
            estimated_max_run_cost_usd: apiBudget.estimatedMaxRunCostUsd,
            social_graph_max_items: socialGraphMaxItems ?? null,
            include_media: shouldIncludeMedia,
          },
        },
        retention:
          retention?.mode === 'guest_30d' && retention.expiresAtIso
            ? {
                mode: 'guest_30d',
                expires_at: retention.expiresAtIso,
              }
            : {
                mode: 'account',
              },
        storage: {
          media_bytes: 0,
          archive_bytes: 0,
          total_bytes: 0,
          media_files: 0,
          updated_at: new Date().toISOString(),
        },
      },
    }

    const { data: insertedBackup, error: backupError } = await supabase
      .from('backups')
      .insert(backupSnapshot)
      .select()
      .single()

    if (backupError) {
      throw new Error(`Failed to save backup: ${backupError.message}`)
    }

    backupId = insertedBackup.id
    await mergeBackupJobPayload(supabase, jobId, {
      partial_backup_id: backupId,
    })
    await ensureSnapshotJobNotCancelled(jobId)

    const totalMediaWorkItems = totalMediaCount
    let completedMediaItems = 0

    const updateMediaProgress = async () => {
      await syncLiveMetrics({
        phase: 'media',
        media_total: totalMediaWorkItems,
        media_processed: completedMediaItems,
      })
    }

    await syncLiveMetrics({ phase: totalMediaWorkItems > 0 ? 'media' : 'finalizing' })
    await ensureSnapshotJobNotCancelled(jobId)

    if (shouldIncludeMedia && targets.profile) {
      await processScrapedProfileMedia(
        userId,
        insertedBackup.id,
        result.metadata.profileImageUrl,
        result.metadata.coverImageUrl,
        async () => {
          completedMediaItems += 1
          await updateMediaProgress()
        },
        async () => ensureSnapshotJobNotCancelled(jobId),
      )
    }

    if (shouldIncludeMedia && tweetMediaCount > 0) {
      await processScrapedMedia(
        userId,
        insertedBackup.id,
        timelineItemsWithMedia,
        async () => {
          completedMediaItems += 1
          await updateMediaProgress()
        },
        async () => ensureSnapshotJobNotCancelled(jobId),
      )
    }

    if (tweetMediaCount > 0) {
      const { data: currentBackup } = await supabase
        .from('backups')
        .select('data')
        .eq('id', insertedBackup.id)
        .maybeSingle()

      const currentData =
        currentBackup?.data && typeof currentBackup.data === 'object' && !Array.isArray(currentBackup.data)
          ? (currentBackup.data as Record<string, unknown>)
          : {}

      await supabase
        .from('backups')
        .update({
          data: {
            ...currentData,
            tweets: result.tweets,
            replies: result.replies,
          },
        })
        .eq('id', insertedBackup.id)
    }

    await syncLiveMetrics({ phase: 'finalizing' })
    await ensureSnapshotJobNotCancelled(jobId)
    await recalculateAndPersistBackupStorage(supabase, insertedBackup.id)

    const reminderPayloadPatch: Record<string, unknown> = {}
    try {
      const latestJob = await getBackupJobForUser(supabase, jobId, userId)
      const latestPayload = toRecord(latestJob?.payload)
      const reminderEmail = readTrimmed(latestPayload.reminder_email).toLowerCase()
      const reminderAlreadySent = readTrimmed(latestPayload.reminder_delivery_status) === 'sent'

      if (!reminderAlreadySent && EMAIL_PATTERN.test(reminderEmail)) {
        const appBaseUrl = resolveConfiguredAppBaseUrl()
        if (!appBaseUrl) {
          reminderPayloadPatch.reminder_delivery_status = 'failed'
          reminderPayloadPatch.reminder_error =
            'APP_BASE_URL (or NEXTAUTH_URL / NEXT_PUBLIC_APP_URL) is required for reminder emails.'
        } else {
          const delivery = await sendBackupReadyEmail({
            email: reminderEmail,
            backupId: insertedBackup.id,
            appBaseUrl,
          })
          reminderPayloadPatch.reminder_delivery_status = 'sent'
          reminderPayloadPatch.reminder_sent_at = new Date().toISOString()
          reminderPayloadPatch.reminder_error = null
          reminderPayloadPatch.reminder_share_url = delivery.shareUrl
        }
      }
    } catch (reminderError) {
      reminderPayloadPatch.reminder_delivery_status = 'failed'
      reminderPayloadPatch.reminder_error =
        reminderError instanceof Error ? reminderError.message : 'Failed to send reminder email.'
    }

    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: 'completed',
      partial_backup_id: null,
      live_metrics: liveMetrics,
      ...reminderPayloadPatch,
      apify_runs: {
        timeline_run_id: null,
        social_graph_run_id: null,
      },
    })
    await markBackupJobCompleted(supabase, jobId, insertedBackup.id, 'Snapshot backup completed successfully.')
  } catch (error) {
    if (isCancellationError(error)) {
      await markBackupJobCleanup(supabase, jobId, 'Cancellation requested. Cleaning up partial data...')

      if (backupId) {
        try {
          await deleteBackupAndStorageById(supabase, {
            backupId,
            expectedUserId: userId,
          })
        } catch (cleanupError) {
          console.error(`[Scrape Job] Cleanup failed for backup ${backupId}:`, cleanupError)
        }
      }

      await mergeBackupJobPayload(supabase, jobId, {
        lifecycle_state: 'cancelled',
        partial_backup_id: null,
        live_metrics: liveMetrics,
        apify_runs: {
          timeline_run_id: null,
          social_graph_run_id: null,
        },
      })
      await markBackupJobFailed(supabase, jobId, 'Cancelled by user', 'Cancelled')
      return
    }

    console.error('[Scrape Job] Error:', error)
    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: 'failed',
      live_metrics: liveMetrics,
      apify_runs: {
        timeline_run_id: null,
        social_graph_run_id: null,
      },
    })
    await markBackupJobFailed(
      supabase,
      jobId,
      error instanceof Error ? error.message : 'Failed to scrape Twitter data',
    )
  }
}
