import { NextResponse } from 'next/server'
import {
  createBackupJob,
  findActiveBackupJobForUser,
  isBackupJobCancellationRequested,
  markBackupJobCompleted,
  markBackupJobCleanup,
  markBackupJobFailed,
  markBackupJobProcessing,
  markBackupJobProgress,
  mergeBackupJobPayload,
} from '@/lib/jobs/backup-jobs'
import {
  TWITTER_SCRAPE_API_LIMITS,
  USER_STORAGE_LIMITS,
} from '@/lib/platforms/twitter/limits'
import { getTwitterApiUsageSummary } from '@/lib/platforms/twitter/api-usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getTwitterProvider } from '@/lib/twitter/twitter-service'
import type { Tweet, TwitterScrapeTargets } from '@/lib/twitter/types'
import {
  estimateApifySocialGraphCostUsd,
  estimateApifyTimelineCostUsd,
  maxApifyTimelineItemsForBudget,
  maxApifySocialGraphItemsForBudget,
  roundUsd,
} from '@/lib/twitter/apify-pricing'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'
import { calculateUserStorageSummary, recalculateAndPersistBackupStorage } from '@/lib/storage/usage'

const supabase = createAdminClient()
const TWITTER_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/
const DEFAULT_SCRAPE_TARGETS: TwitterScrapeTargets = {
  profile: true,
  tweets: true,
  replies: true,
  followers: true,
  following: true,
}

const OPTIONAL_MEDIA_FILE_COLUMNS = new Set([
  'file_name',
  'file_size',
  'mime_type',
  'media_type',
  'tweet_id',
])

function formatUsd(value: number): string {
  return `$${roundUsd(value).toFixed(2)}`
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
  return error.name === 'RunCancelledError'
    || message.includes('cancelled by user')
    || message.includes('cancellation requested')
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

function parseScrapeTargets(value: unknown): TwitterScrapeTargets | null {
  if (value === undefined || value === null) return { ...DEFAULT_SCRAPE_TARGETS }
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const source = value as Record<string, unknown>
  const read = (key: keyof TwitterScrapeTargets) => {
    if (source[key] === undefined) return DEFAULT_SCRAPE_TARGETS[key]
    return Boolean(source[key])
  }

  return {
    profile: read('profile'),
    tweets: read('tweets'),
    replies: read('replies'),
    followers: read('followers'),
    following: read('following'),
  }
}

function resolveAppBaseUrl(request: Request): string | null {
  const configured = [
    process.env.APP_BASE_URL,
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ]

  for (const candidate of configured) {
    if (!candidate) continue
    const value = candidate.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(value)) continue
    return value
  }

  try {
    const origin = new URL(request.url).origin
    if (/^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, '')
  } catch {}

  return null
}

function hasExplicitValue(value: unknown): boolean {
  return !(value === undefined || value === null || value === '')
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN
  if (!Number.isFinite(parsed)) return null
  if (!Number.isInteger(parsed)) return null
  if (parsed <= 0) return null
  return parsed
}

/**
 * Download and store profile + cover photos for a scraped backup.
 * Runs after backup row is inserted so we can update data.profile with storage paths.
 */
async function processScrapedProfileMedia(
  userId: string,
  backupId: string,
  profileImageUrl: string | undefined,
  coverImageUrl: string | undefined,
  onMediaProcessed?: () => Promise<void>,
  ensureActive?: () => Promise<void>,
) {
  if (!profileImageUrl && !coverImageUrl) return

  console.log(`[Profile Media] Processing profile photos for backup ${backupId}`)

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

      const storagePath = `${userId}/profile_media/${filename}`

      const { error: uploadError } = await supabase.storage
        .from('twitter-media')
        .upload(storagePath, buffer, { contentType, upsert: true })

      if (uploadError && uploadError.message !== 'The resource already exists') {
        console.error(`[Profile Media] Upload error for ${filename}:`, uploadError)
        return null
      }

      // Upsert media_files record
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

      console.log(`[Profile Media] Uploaded ${filename}`)
      return storagePath
    } catch (err) {
      console.error(`[Profile Media] Error processing ${filename}:`, err)
      return null
    }
  }

  let profileStoragePath: string | null = null
  let coverStoragePath: string | null = null

  if (profileImageUrl) {
    if (ensureActive) await ensureActive()
    profileStoragePath = await uploadImage(profileImageUrl, 'profile_photo_400x400.jpg')
    if (onMediaProcessed) await onMediaProcessed()
  }

  if (coverImageUrl) {
    if (ensureActive) await ensureActive()
    coverStoragePath = await uploadImage(coverImageUrl, 'cover_photo.jpg')
    if (onMediaProcessed) await onMediaProcessed()
  }

  // Update backup.data.profile with the storage paths so profile-media API can serve signed URLs
  if (profileStoragePath || coverStoragePath) {
    const { data: backup } = await supabase
      .from('backups')
      .select('data')
      .eq('id', backupId)
      .single()

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

      console.log(`[Profile Media] Updated backup profile paths: profile=${profileStoragePath}, cover=${coverStoragePath}`)
    }
  }
}

/**
 * Download and store media files from scraped tweets.
 */
async function processScrapedMedia(
  userId: string,
  backupId: string,
  tweetsWithMedia: Tweet[],
  onMediaProcessed?: () => Promise<void>,
  ensureActive?: () => Promise<void>,
) {
  let processedCount = 0
  let errorCount = 0
  let totalCount = 0

  for (const tweet of tweetsWithMedia) {
    if (!tweet.media || tweet.media.length === 0) continue

    for (const media of tweet.media) {
      totalCount += 1
      if (ensureActive && totalCount % 5 === 1) {
        await ensureActive()
      }

      try {
        if (!media.media_url) {
          console.warn(`[Scraped Media] No media_url for tweet ${tweet.id}, skipping`)
          continue
        }

        // Download the media file
        const response = await fetch(media.media_url)
        if (!response.ok) {
          console.error(`[Scraped Media] Failed to download ${media.media_url}: ${response.statusText}`)
          errorCount++
          continue
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Generate filename from URL
        const urlParts = media.media_url.split('/')
        const filename = urlParts[urlParts.length - 1] || `${tweet.id}-${media.type}`

        // Determine MIME type
        const mimeType = media.type === 'photo' ? 'image/jpeg'
          : media.type === 'video' ? 'video/mp4'
          : 'image/gif'

        // Upload to storage
        const storagePath = `${userId}/scraped_media/${filename}`
        const { error: uploadError } = await supabase.storage
          .from('twitter-media')
          .upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: true  // Overwrite if exists
          })

        if (uploadError && uploadError.message !== 'The resource already exists') {
          console.error(`[Scraped Media] Upload error for ${filename}:`, uploadError)
          errorCount++
          continue
        }

        // Create database record
        const metadataRecord = {
          user_id: userId,
          backup_id: backupId,
          file_path: storagePath,
          file_name: filename,
          file_size: buffer.length,
          mime_type: mimeType,
          media_type: 'scraped_media',
          tweet_id: tweet.id,
        }

        // Check if record already exists for this backup + file path
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
            continue
          }
        }

        processedCount++
        if (processedCount % 10 === 0) {
          console.log(`[Scraped Media] Processed ${processedCount} media files so far`)
        }

      } catch (error) {
        console.error('[Scraped Media] Error processing media:', error)
        errorCount++
      } finally {
        if (onMediaProcessed) await onMediaProcessed()
      }
    }
  }

  console.log(`[Scraped Media] Complete: ${processedCount} processed, ${errorCount} errors, ${totalCount} total`)
}

async function processSnapshotScrapeJob(params: {
  jobId: string
  userId: string
  username: string
  tweetsToScrape: number
  targets: TwitterScrapeTargets
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
  const { jobId, userId, username, tweetsToScrape, targets, socialGraphMaxItems, apifyWebhook, apiBudget } = params
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

  const shouldPersistLiveMetrics = (
    nextMetrics: SnapshotLiveMetrics,
    force: boolean,
  ) => {
    if (force) return true
    if (nextMetrics.phase !== lastPersistedMetrics.phase) return true

    const now = Date.now()
    const timelineMoved =
      Math.abs(nextMetrics.tweets_fetched - lastPersistedMetrics.tweets_fetched) >= LIVE_TIMELINE_STEP
      || Math.abs(nextMetrics.replies_fetched - lastPersistedMetrics.replies_fetched) >= LIVE_TIMELINE_STEP
    const socialMoved =
      Math.abs(nextMetrics.followers_fetched - lastPersistedMetrics.followers_fetched) >= LIVE_SOCIAL_STEP
      || Math.abs(nextMetrics.following_fetched - lastPersistedMetrics.following_fetched) >= LIVE_SOCIAL_STEP
    const mediaMoved =
      Math.abs(nextMetrics.media_processed - lastPersistedMetrics.media_processed) >= LIVE_MEDIA_STEP
      || Math.abs(nextMetrics.media_total - lastPersistedMetrics.media_total) >= LIVE_MEDIA_STEP
    const firstNonZeroSnapshot =
      (lastPersistedMetrics.tweets_fetched === 0 && nextMetrics.tweets_fetched > 0)
      || (lastPersistedMetrics.replies_fetched === 0 && nextMetrics.replies_fetched > 0)
      || (lastPersistedMetrics.followers_fetched === 0 && nextMetrics.followers_fetched > 0)
      || (lastPersistedMetrics.following_fetched === 0 && nextMetrics.following_fetched > 0)

    const crossedStep = timelineMoved || socialMoved || mediaMoved || firstNonZeroSnapshot
    if (crossedStep && now - lastPersistedAt >= LIVE_METRIC_MIN_PERSIST_MS) return true
    if (Math.abs(nextMetrics.api_cost_usd - lastPersistedMetrics.api_cost_usd) >= 0.01) return true

    return now - lastPersistedAt >= LIVE_METRIC_MAX_SILENCE_MS
  }

  const syncLiveMetrics = async (
    patch: Partial<SnapshotLiveMetrics>,
    options?: { force?: boolean },
  ) => {
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

    // Scrape selected data
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
        await syncLiveMetrics({
          phase: progress.phase,
          tweets_fetched: progress.tweets_fetched,
          replies_fetched: progress.replies_fetched,
          followers_fetched: progress.followers_fetched,
          following_fetched: progress.following_fetched,
          api_cost_usd: progress.api_cost_usd,
        }, { force: forceSync })
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
    const profileMediaCount = targets.profile
      ? (result.metadata.profileImageUrl ? 1 : 0) + (result.metadata.coverImageUrl ? 1 : 0)
      : 0
    const totalMediaCount = tweetMediaCount + profileMediaCount

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

    // Save to Supabase
    const backupSnapshot = {
      user_id: userId,
      backup_type: 'snapshot',
      source: 'scrape',
      data: {
        tweets: result.tweets,
        replies: result.replies,
        followers: result.followers,
        following: result.following,
        likes: [], // Scraping doesn't get likes
        direct_messages: [], // Scraping doesn't get DMs
        profile: {
          username: result.metadata.username,
          displayName: result.metadata.displayName,
          profileImageUrl: result.metadata.profileImageUrl,
          coverImageUrl: result.metadata.coverImageUrl,
          followersCount: result.metadata.profileFollowersCount,
          followingCount: result.metadata.profileFollowingCount,
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
          },
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

    // Download and store profile + cover photos
    if (targets.profile) {
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

    // Download and store media files from scraped timeline (tweets + replies)
    if (tweetMediaCount > 0) {
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

    await syncLiveMetrics({ phase: 'finalizing' })
    await ensureSnapshotJobNotCancelled(jobId)
    await recalculateAndPersistBackupStorage(supabase, insertedBackup.id)

    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: 'completed',
      partial_backup_id: null,
      live_metrics: liveMetrics,
      apify_runs: {
        timeline_run_id: null,
        social_graph_run_id: null,
      },
    })
    await markBackupJobCompleted(supabase, jobId, insertedBackup.id, 'Snapshot backup completed successfully.')
  } catch (error) {
    if (isCancellationError(error)) {
      console.log(`[Scrape Job] Cancellation requested for job ${jobId}. Starting cleanup...`)
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

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const activeJob = await findActiveBackupJobForUser(supabase, user.id)
    if (activeJob) {
      return NextResponse.json({
        success: false,
        error: 'A backup job is already in progress. Please wait for it to finish before starting another one.',
        activeJob,
      }, { status: 409 })
    }

    const body = await request.json()
    const { username, maxTweets, targets } = body

    if (!username) {
      return NextResponse.json({ success: false, error: 'Username is required' }, { status: 400 })
    }
    if (typeof username !== 'string' || !TWITTER_USERNAME_PATTERN.test(username)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid username format. Use 1-15 letters, numbers, or underscores.',
      }, { status: 400 })
    }

    const parsedTargets = parseScrapeTargets(targets)
    if (!parsedTargets) {
      return NextResponse.json({
        success: false,
        error: 'Invalid scrape targets. Use booleans for profile, tweets, replies, followers, and following.',
      }, { status: 400 })
    }

    if (!Object.values(parsedTargets).some(Boolean)) {
      return NextResponse.json({
        success: false,
        error: 'Select at least one type of data to scrape.',
      }, { status: 400 })
    }

    const storageSummary = await calculateUserStorageSummary(supabase, user.id)
    if (storageSummary.totalBytes >= USER_STORAGE_LIMITS.maxTotalBytes) {
      return NextResponse.json({
        success: false,
        error: `Storage limit exceeded. Current usage: ${storageSummary.totalBytes} bytes, limit: ${USER_STORAGE_LIMITS.maxTotalBytes} bytes.`,
      }, { status: 413 })
    }

    const needsTimelineScrape = parsedTargets.tweets || parsedTargets.replies
    const includesSocialGraph = parsedTargets.followers || parsedTargets.following
    const hasExplicitMaxTweets = hasExplicitValue(maxTweets)
    let explicitTweetLimit: number | null = null

    if (needsTimelineScrape && hasExplicitMaxTweets) {
      explicitTweetLimit = parsePositiveInteger(maxTweets)
      if (explicitTweetLimit === null) {
        return NextResponse.json({
          success: false,
          error: 'Invalid maxTweets value. It must be a positive integer.',
        }, { status: 400 })
      }
    }

    const twitter = getTwitterProvider()
    if (!twitter.isConfigured()) {
      return NextResponse.json({
        success: false,
        error: `${twitter.getProviderName()} is not configured. Please set up API keys.`,
      }, { status: 500 })
    }

    const apiUsage = await getTwitterApiUsageSummary(supabase, user.id)
    if (apiUsage.remainingUsd <= 0) {
      return NextResponse.json({
        success: false,
        error: `Monthly snapshot token budget reached (${formatUsd(apiUsage.spentUsd)} / ${formatUsd(apiUsage.limitUsd)}).`,
        apiUsage,
      }, { status: 429 })
    }

    const effectiveRunBudgetUsd = roundUsd(Math.min(TWITTER_SCRAPE_API_LIMITS.maxCostPerRunUsd, apiUsage.remainingUsd))

    let tweetsToScrape = 0
    if (needsTimelineScrape) {
      if (explicitTweetLimit !== null) {
        tweetsToScrape = explicitTweetLimit
      } else if (includesSocialGraph) {
        // No explicit maxTweets: keep timeline near the base-price included window
        // so most budget can go to followers/following.
        tweetsToScrape = TWITTER_SCRAPE_API_LIMITS.profileIncludedItems
      } else {
        // Timeline-only scrape with no explicit max: use full run budget automatically.
        tweetsToScrape = maxApifyTimelineItemsForBudget(effectiveRunBudgetUsd)
      }
      tweetsToScrape = Math.max(1, Math.floor(tweetsToScrape))
    } else if (parsedTargets.profile) {
      // Profile-only scrape should stay minimal and cheap.
      tweetsToScrape = 1
    }

    const requestedTimelineItems = needsTimelineScrape
      ? tweetsToScrape
      : (parsedTargets.profile ? 1 : 0)
    const estimatedTimelineCostUsd = estimateApifyTimelineCostUsd(requestedTimelineItems)

    if (estimatedTimelineCostUsd > effectiveRunBudgetUsd) {
      return NextResponse.json({
        success: false,
        error: `This request needs at least ${formatUsd(estimatedTimelineCostUsd)} in snapshot tokens for timeline/profile data, but only ${formatUsd(effectiveRunBudgetUsd)} is currently available for a single run.`,
        apiUsage,
      }, { status: 429 })
    }

    const budgetForSocialGraphUsd = Math.max(0, effectiveRunBudgetUsd - estimatedTimelineCostUsd)
    let socialGraphMaxItems: number | undefined
    let estimatedSocialGraphCostUsd = 0

    if (includesSocialGraph) {
      socialGraphMaxItems = maxApifySocialGraphItemsForBudget(budgetForSocialGraphUsd)
      if (socialGraphMaxItems <= 0) {
        return NextResponse.json({
          success: false,
          error: `Current snapshot token budget cannot fetch followers/following in this run. Increase token limits or uncheck followers/following.`,
          apiUsage,
        }, { status: 429 })
      }
      estimatedSocialGraphCostUsd = estimateApifySocialGraphCostUsd(socialGraphMaxItems)
    }

    const estimatedMaxRunCostUsd = roundUsd(estimatedTimelineCostUsd + estimatedSocialGraphCostUsd)
    const apifyWebhookBaseUrl = resolveAppBaseUrl(request)
    const apifyWebhookToken = process.env.APIFY_WEBHOOK_SECRET?.trim() || undefined
    const apifyWebhookEnabled = twitter.getProviderName() === 'apify' && Boolean(apifyWebhookBaseUrl)
    if (twitter.getProviderName() === 'apify' && !apifyWebhookBaseUrl) {
      console.warn('[Scrape API] Apify webhook disabled: unable to resolve public app base URL.')
    }
    if (apifyWebhookEnabled && !apifyWebhookToken) {
      console.warn('[Scrape API] APIFY_WEBHOOK_SECRET is not configured. Webhook endpoint will be unauthenticated.')
    }

    const job = await createBackupJob(supabase, {
      userId: user.id,
      jobType: 'snapshot_scrape',
      message: 'Snapshot requested. Waiting to start...',
      payload: {
        lifecycle_state: 'queued',
        username: username.trim(),
        max_tweets: tweetsToScrape,
        targets: parsedTargets,
        social_graph_max_items: socialGraphMaxItems ?? null,
        partial_backup_id: null,
        apify_webhook: {
          enabled: apifyWebhookEnabled,
          base_url: apifyWebhookBaseUrl,
          has_token: Boolean(apifyWebhookToken),
          callback_path: '/api/platforms/twitter/apify-webhook',
        },
        apify_runs: {
          timeline_run_id: null,
          social_graph_run_id: null,
        },
        live_metrics: {
          phase: 'queued',
          tweets_fetched: 0,
          replies_fetched: 0,
          followers_fetched: 0,
          following_fetched: 0,
          media_processed: 0,
          media_total: 0,
          api_cost_usd: 0,
        },
        api_budget: {
          monthly_spent_usd: apiUsage.spentUsd,
          monthly_limit_usd: apiUsage.limitUsd,
          monthly_remaining_usd: apiUsage.remainingUsd,
          per_run_limit_usd: roundUsd(TWITTER_SCRAPE_API_LIMITS.maxCostPerRunUsd),
          effective_run_budget_usd: effectiveRunBudgetUsd,
          estimated_timeline_cost_usd: estimatedTimelineCostUsd,
          estimated_social_graph_cost_usd: estimatedSocialGraphCostUsd,
          estimated_max_run_cost_usd: estimatedMaxRunCostUsd,
        },
      },
    })

    void processSnapshotScrapeJob({
      jobId: job.id,
      userId: user.id,
      username: username.trim(),
      tweetsToScrape,
      targets: parsedTargets,
      socialGraphMaxItems,
      apifyWebhook: apifyWebhookEnabled && apifyWebhookBaseUrl
        ? {
            baseUrl: apifyWebhookBaseUrl,
            token: apifyWebhookToken,
          }
        : undefined,
      apiBudget: {
        monthlySpentBeforeRunUsd: apiUsage.spentUsd,
        monthlyLimitUsd: apiUsage.limitUsd,
        monthlyRemainingUsd: apiUsage.remainingUsd,
        perRunLimitUsd: roundUsd(TWITTER_SCRAPE_API_LIMITS.maxCostPerRunUsd),
        effectiveRunBudgetUsd,
        estimatedTimelineCostUsd,
        estimatedSocialGraphCostUsd,
        estimatedMaxRunCostUsd,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Snapshot queued. Your job is now running in the background.',
      budget: {
        effectiveRunBudgetUsd,
        estimatedTimelineCostUsd,
        estimatedSocialGraphCostUsd,
        estimatedMaxRunCostUsd,
        socialGraphMaxItems: socialGraphMaxItems ?? null,
      },
      apiUsage,
      job,
    })

  } catch (error) {
    console.error('[Scrape API] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to scrape Twitter data',
    }, { status: 500 })
  }
}
