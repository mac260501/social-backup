import { NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import {
  createBackupJob,
  findActiveBackupJobForUser,
  markBackupJobFailed,
  mergeBackupJobPayload,
} from '@/lib/jobs/backup-jobs'
import {
  TWITTER_SCRAPE_API_LIMITS,
  TWITTER_SCRAPE_LIMITS,
  USER_STORAGE_LIMITS,
} from '@/lib/platforms/twitter/limits'
import { getTwitterApiUsageSummary } from '@/lib/platforms/twitter/api-usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getTwitterProvider } from '@/lib/twitter/twitter-service'
import type { TwitterScrapeTargets } from '@/lib/twitter/types'
import {
  estimateApifySocialGraphCostUsd,
  estimateApifyTimelineCostUsd,
  maxApifyTimelineItemsForBudget,
  maxApifySocialGraphItemsForBudget,
  roundUsd,
} from '@/lib/twitter/apify-pricing'
import { calculateUserStorageSummary } from '@/lib/storage/usage'

const supabase = createAdminClient()
const TWITTER_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/
const DEFAULT_SCRAPE_TARGETS: TwitterScrapeTargets = {
  profile: true,
  tweets: true,
  replies: true,
  followers: true,
  following: true,
}

function extractInngestEventIds(response: unknown): string[] {
  if (!response || typeof response !== 'object') return []
  const ids = (response as { ids?: unknown }).ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function formatUsd(value: number): string {
  return `$${roundUsd(value).toFixed(2)}`
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
  } catch {
    return null
  }

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

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const activeJob = await findActiveBackupJobForUser(supabase, user.id)
    if (activeJob) {
      return NextResponse.json(
        {
          success: false,
          error: 'A backup job is already in progress. Please wait for it to finish before starting another one.',
          activeJob,
        },
        { status: 409 },
      )
    }

    const body = await request.json()
    const { username, maxTweets, targets } = body

    if (!username) {
      return NextResponse.json({ success: false, error: 'Username is required' }, { status: 400 })
    }
    if (typeof username !== 'string' || !TWITTER_USERNAME_PATTERN.test(username)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid username format. Use 1-15 letters, numbers, or underscores.',
        },
        { status: 400 },
      )
    }

    const parsedTargets = parseScrapeTargets(targets)
    if (!parsedTargets) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid scrape targets. Use booleans for profile, tweets, replies, followers, and following.',
        },
        { status: 400 },
      )
    }

    if (!Object.values(parsedTargets).some(Boolean)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Select at least one type of data to scrape.',
        },
        { status: 400 },
      )
    }

    const storageSummary = await calculateUserStorageSummary(supabase, user.id)
    if (storageSummary.totalBytes >= USER_STORAGE_LIMITS.maxTotalBytes) {
      return NextResponse.json(
        {
          success: false,
          error: `Storage limit exceeded. Current usage: ${storageSummary.totalBytes} bytes, limit: ${USER_STORAGE_LIMITS.maxTotalBytes} bytes.`,
        },
        { status: 413 },
      )
    }

    const needsTimelineScrape = parsedTargets.tweets || parsedTargets.replies
    const includesSocialGraph = parsedTargets.followers || parsedTargets.following
    const hasExplicitMaxTweets = hasExplicitValue(maxTweets)
    let explicitTweetLimit: number | null = null

    if (needsTimelineScrape && hasExplicitMaxTweets) {
      explicitTweetLimit = parsePositiveInteger(maxTweets)
      if (explicitTweetLimit === null) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid maxTweets value. It must be a positive integer.',
          },
          { status: 400 },
        )
      }
    }

    const twitter = getTwitterProvider()
    if (!twitter.isConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: `${twitter.getProviderName()} is not configured. Please set up API keys.`,
        },
        { status: 500 },
      )
    }

    const apiUsage = await getTwitterApiUsageSummary(supabase, user.id)
    if (apiUsage.remainingUsd <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Monthly snapshot token budget reached (${formatUsd(apiUsage.spentUsd)} / ${formatUsd(apiUsage.limitUsd)}).`,
          apiUsage,
        },
        { status: 429 },
      )
    }

    const effectiveRunBudgetUsd = roundUsd(Math.min(TWITTER_SCRAPE_API_LIMITS.maxCostPerRunUsd, apiUsage.remainingUsd))

    let tweetsToScrape = 0
    if (needsTimelineScrape) {
      if (explicitTweetLimit !== null) {
        tweetsToScrape = explicitTweetLimit
      } else if (includesSocialGraph) {
        // Keep timeline broad, but avoid starving followers/following budget in mixed runs.
        const preferredDefaultTweets = Math.max(1, TWITTER_SCRAPE_LIMITS.defaultTweets)
        const preferredDefaultCostUsd = estimateApifyTimelineCostUsd(preferredDefaultTweets)
        tweetsToScrape =
          preferredDefaultCostUsd <= effectiveRunBudgetUsd
            ? preferredDefaultTweets
            : maxApifyTimelineItemsForBudget(effectiveRunBudgetUsd)
      } else {
        tweetsToScrape = maxApifyTimelineItemsForBudget(effectiveRunBudgetUsd)
      }
      tweetsToScrape = Math.max(1, Math.floor(tweetsToScrape))
    } else if (parsedTargets.profile) {
      tweetsToScrape = 1
    }

    const requestedTimelineItems = needsTimelineScrape ? tweetsToScrape : parsedTargets.profile ? 1 : 0
    const estimatedTimelineCostUsd = estimateApifyTimelineCostUsd(requestedTimelineItems)

    if (estimatedTimelineCostUsd > effectiveRunBudgetUsd) {
      return NextResponse.json(
        {
          success: false,
          error: `This request needs at least ${formatUsd(estimatedTimelineCostUsd)} in snapshot tokens for timeline/profile data, but only ${formatUsd(effectiveRunBudgetUsd)} is currently available for a single run.`,
          apiUsage,
        },
        { status: 429 },
      )
    }

    const budgetForSocialGraphUsd = Math.max(0, effectiveRunBudgetUsd - estimatedTimelineCostUsd)
    let socialGraphMaxItems: number | undefined
    let estimatedSocialGraphCostUsd = 0

    if (includesSocialGraph) {
      socialGraphMaxItems = maxApifySocialGraphItemsForBudget(budgetForSocialGraphUsd)
      if (socialGraphMaxItems <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Current snapshot token budget cannot fetch followers/following in this run. Increase token limits or uncheck followers/following.',
            apiUsage,
          },
          { status: 429 },
        )
      }
      estimatedSocialGraphCostUsd = estimateApifySocialGraphCostUsd(socialGraphMaxItems)
    }

    const estimatedMaxRunCostUsd = roundUsd(estimatedTimelineCostUsd + estimatedSocialGraphCostUsd)
    const apifyWebhookBaseUrl = resolveAppBaseUrl(request)
    const apifyWebhookToken = process.env.APIFY_WEBHOOK_SECRET?.trim() || undefined
    const apifyWebhookEnabled =
      twitter.getProviderName() === 'apify' && Boolean(apifyWebhookBaseUrl) && Boolean(apifyWebhookToken)

    if (twitter.getProviderName() === 'apify' && !apifyWebhookBaseUrl) {
      console.warn('[Scrape API] Apify webhook disabled: unable to resolve public app base URL.')
    }
    if (twitter.getProviderName() === 'apify' && apifyWebhookBaseUrl && !apifyWebhookToken) {
      console.warn('[Scrape API] APIFY_WEBHOOK_SECRET is not configured. Webhook callbacks are disabled for safety.')
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

    try {
      const sendResult = await inngest.send({
        name: 'backup/snapshot-scrape.requested',
        data: {
          jobId: job.id,
          userId: user.id,
          username: username.trim(),
          tweetsToScrape,
          targets: parsedTargets,
          socialGraphMaxItems,
          apifyWebhook:
            apifyWebhookEnabled && apifyWebhookBaseUrl
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
        },
      })

      const eventIds = extractInngestEventIds(sendResult)
      if (eventIds.length > 0) {
        await mergeBackupJobPayload(supabase, job.id, {
          inngest_event_ids: eventIds,
        })
      }
    } catch (enqueueError) {
      await markBackupJobFailed(
        supabase,
        job.id,
        `Failed to queue background processing: ${enqueueError instanceof Error ? enqueueError.message : 'Unknown error'}`,
      )
      throw enqueueError
    }

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
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to scrape Twitter data',
      },
      { status: 500 },
    )
  }
}
