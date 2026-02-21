import { ApifyClient } from 'apify-client'
import { TwitterProvider } from '../twitter-provider.interface'
import {
  Follower,
  Following,
  Tweet,
  TweetMedia,
  TwitterScrapeOptions,
  TwitterScrapeProgressUpdate,
  TwitterScrapeResult,
  TwitterScrapeTargets,
} from '../types'
import {
  estimateApifySocialGraphCostUsd,
  estimateApifyTimelineCostUsd,
  estimateApifyTimelineExtraItemsCostUsd,
  roundUsd,
} from '../apify-pricing'

type ProfileMetadata = {
  profileImageUrl?: string
  coverImageUrl?: string
  displayName?: string
  followersCount?: number
  followingCount?: number
}

type TimelineScrape = {
  tweets: Tweet[]
  replies: Tweet[]
  profile: ProfileMetadata
  totalItems: number
}

type SocialGraphScrape = {
  followers: Follower[]
  following: Following[]
  profile: ProfileMetadata
  totalItems: number
}

type SocialUser = {
  user_id: string
  username?: string
  name?: string
  userLink: string
  profileImageUrl?: string
}

type RunDatasetPollResult = {
  items: Record<string, unknown>[]
  finalStatus: string
}

class RunCancelledError extends Error {
  constructor(message: string = 'Job cancelled by user') {
    super(message)
    this.name = 'RunCancelledError'
  }
}

const DEFAULT_TARGETS: TwitterScrapeTargets = {
  profile: true,
  tweets: true,
  replies: true,
  followers: true,
  following: true,
}

const PROGRESS_UPDATE_ITEM_INTERVAL = 50
const APIFY_TERMINAL_WEBHOOK_EVENTS = [
  'ACTOR.RUN.SUCCEEDED',
  'ACTOR.RUN.FAILED',
  'ACTOR.RUN.TIMED_OUT',
  'ACTOR.RUN.ABORTED',
] as const

type TimelineProgress = {
  tweets: number
  replies: number
  totalItems: number
  runId?: string
}

type SocialGraphProgress = {
  followers: number
  following: number
  totalItems: number
  runId?: string
}

/**
 * Apify Twitter Scraper Provider
 * Uses:
 * - apidojo/twitter-profile-scraper (profile, tweets, replies)
 * - apidojo/twitter-user-scraper (followers, following)
 */
export class ApifyProvider implements TwitterProvider {
  private apiKey: string
  private profileActorId = 'apidojo/twitter-profile-scraper'
  private userActorId = 'apidojo/twitter-user-scraper'
  private client: ApifyClient

  constructor() {
    this.apiKey = process.env.APIFY_API_KEY || ''
    this.client = new ApifyClient({ token: this.apiKey })
  }

  async scrapeTweets(username: string, maxTweets: number): Promise<Tweet[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }
    const result = await this.scrapeTimeline(username, maxTweets)
    return result.tweets
  }

  async scrapeReplies(username: string, maxTweets: number): Promise<Tweet[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }
    const result = await this.scrapeTimeline(username, maxTweets)
    return result.replies
  }

  async scrapeFollowers(username: string): Promise<Follower[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }
    const result = await this.scrapeSocialGraph(username, { followers: true, following: false })
    return result.followers
  }

  async scrapeFollowing(username: string): Promise<Following[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }
    const result = await this.scrapeSocialGraph(username, { followers: false, following: true })
    return result.following
  }

  async scrapeProfile(username: string): Promise<ProfileMetadata> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }

    // Pull a minimal page to obtain author-level profile metadata.
    const result = await this.scrapeTimeline(username, 1)
    return result.profile
  }

  async scrapeAll(username: string, maxTweets: number = 3200, options?: TwitterScrapeOptions): Promise<TwitterScrapeResult> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }

    const targets = this.resolveTargets(options)
    const onProgress = options?.onProgress
    const shouldCancel = options?.shouldCancel
    const apifyWebhook = options?.apifyWebhook
    const startTime = Date.now()

    console.log(`[Apify] Starting selective scrape for @${username}`, targets)

    let tweets: Tweet[] = []
    let replies: Tweet[] = []
    let followers: Follower[] = []
    let following: Following[] = []
    let profile: ProfileMetadata = {}
    let timelineItemCount = 0

    const emitProgress = async (update: TwitterScrapeProgressUpdate) => {
      if (!onProgress) return
      await onProgress(update)
    }

    if (targets.profile || targets.tweets || targets.replies) {
      const timeline = await this.scrapeTimeline(username, maxTweets, async (progress) => {
        timelineItemCount = Math.max(timelineItemCount, progress.totalItems)
        await emitProgress({
          phase: 'timeline',
          tweets_fetched: progress.tweets,
          replies_fetched: progress.replies,
          followers_fetched: 0,
          following_fetched: 0,
          api_cost_usd: estimateApifyTimelineCostUsd(progress.totalItems),
          timeline_run_id: progress.runId,
        })
      }, shouldCancel, apifyWebhook)
      timelineItemCount = timeline.totalItems
      if (targets.tweets) tweets = timeline.tweets
      if (targets.replies) replies = timeline.replies
      if (targets.profile) profile = timeline.profile

      await emitProgress({
        phase: 'timeline',
        tweets_fetched: tweets.length,
        replies_fetched: replies.length,
        followers_fetched: 0,
        following_fetched: 0,
        api_cost_usd: estimateApifyTimelineCostUsd(timelineItemCount),
      })
    }

    const socialGraphMaxItems =
      typeof options?.socialGraphMaxItems === 'number' && Number.isFinite(options.socialGraphMaxItems)
        ? Math.max(1, Math.floor(options.socialGraphMaxItems))
        : undefined

    let socialGraphItemCount = 0

    if (targets.followers || targets.following) {
      const graph = await this.scrapeSocialGraph(username, {
        followers: targets.followers,
        following: targets.following,
      }, socialGraphMaxItems, async (progress) => {
        socialGraphItemCount = Math.max(socialGraphItemCount, progress.totalItems)
        const timelineCost = targets.profile || targets.tweets || targets.replies
          ? estimateApifyTimelineCostUsd(timelineItemCount)
          : 0
        await emitProgress({
          phase: targets.followers && targets.following ? 'social_graph' : targets.followers ? 'followers' : 'following',
          tweets_fetched: tweets.length,
          replies_fetched: replies.length,
          followers_fetched: progress.followers,
          following_fetched: progress.following,
          api_cost_usd: roundUsd(timelineCost + estimateApifySocialGraphCostUsd(progress.totalItems)),
          social_graph_run_id: progress.runId,
        })
      }, shouldCancel, apifyWebhook)
      socialGraphItemCount = graph.totalItems
      followers = graph.followers
      following = graph.following
      // Even when "profile" isn't explicitly selected, user-scraper returns the owner row.
      // Use it to keep profile display/counts accurate for followers/following-only snapshots.
      profile = {
        ...graph.profile,
        ...profile,
      }

      await emitProgress({
        phase: targets.followers && targets.following ? 'social_graph' : targets.followers ? 'followers' : 'following',
        tweets_fetched: tweets.length,
        replies_fetched: replies.length,
        followers_fetched: followers.length,
        following_fetched: following.length,
        api_cost_usd: roundUsd(
          (targets.profile || targets.tweets || targets.replies ? estimateApifyTimelineCostUsd(timelineItemCount) : 0)
          + estimateApifySocialGraphCostUsd(socialGraphItemCount),
        ),
      })
    }

    const firstAuthor = [...tweets, ...replies].find((item) => item.author?.name || item.author?.profileImageUrl)?.author
    const profileImageUrl = profile.profileImageUrl || firstAuthor?.profileImageUrl
    const coverImageUrl = profile.coverImageUrl
    const displayName = profile.displayName || firstAuthor?.name || username

    const timelineQueried = targets.profile || targets.tweets || targets.replies
    const timelineCost = timelineQueried ? estimateApifyTimelineCostUsd(timelineItemCount) : 0
    const timelineExtraItemsCost = timelineQueried ? estimateApifyTimelineExtraItemsCostUsd(timelineItemCount) : 0
    const socialGraphCost = estimateApifySocialGraphCostUsd(socialGraphItemCount)
    const totalCost = roundUsd(timelineCost + socialGraphCost)

    const timelineRequested = targets.tweets || targets.replies
    const timelineReturned = tweets.length + replies.length
    const timelineDistributionDivisor = Math.max(1, timelineReturned)
    const tweetWeight = tweets.length / timelineDistributionDivisor
    const replyWeight = replies.length / timelineDistributionDivisor
    const tweetCost = timelineExtraItemsCost * tweetWeight
    const replyCost = timelineExtraItemsCost * replyWeight
    const profileCost = timelineQueried ? timelineCost - (tweetCost + replyCost) : 0
    const socialDistributionDivisor = Math.max(1, followers.length + following.length)
    const followerWeight = followers.length / socialDistributionDivisor
    const followingWeight = following.length / socialDistributionDivisor
    const followerCost = socialGraphCost * followerWeight
    const followingCost = socialGraphCost * followingWeight
    const socialGraphCapHit = typeof socialGraphMaxItems === 'number' && socialGraphMaxItems > 0
      ? socialGraphItemCount >= socialGraphMaxItems
      : false
    const timelineLimitHit = timelineRequested && maxTweets > 0
      ? timelineItemCount >= maxTweets
      : false
    const partialReasons: string[] = []
    if (timelineLimitHit) partialReasons.push('timeline_limit_reached')
    if (socialGraphCapHit) partialReasons.push('social_graph_budget_cap_reached')

    await emitProgress({
      phase: 'complete',
      tweets_fetched: tweets.length,
      replies_fetched: replies.length,
      followers_fetched: followers.length,
      following_fetched: following.length,
      api_cost_usd: totalCost,
    })

    console.log('[Apify] Selective scrape complete', {
      tweets: tweets.length,
      replies: replies.length,
      followers: followers.length,
      following: following.length,
      totalCost,
      elapsedMs: Date.now() - startTime,
    })

    return {
      tweets,
      replies,
      followers,
      following,
      cost: {
        provider: 'apify',
        total_cost: totalCost,
        tweets_count: timelineReturned,
        breakdown: {
          profile_query: roundUsd(timelineQueried ? timelineCost - timelineExtraItemsCost : 0),
          timeline_extra_items: roundUsd(timelineExtraItemsCost),
          tweets: roundUsd(tweetCost),
          replies: roundUsd(replyCost),
          profile: roundUsd(profileCost),
          followers: roundUsd(followerCost),
          following: roundUsd(followingCost),
        },
      },
      metadata: {
        username,
        scraped_at: new Date().toISOString(),
        is_partial: partialReasons.length > 0,
        partial_reasons: partialReasons,
        timeline_limit_hit: timelineLimitHit,
        social_graph_limit_hit: socialGraphCapHit,
        tweets_requested: timelineRequested ? maxTweets : 0,
        tweets_received: timelineReturned,
        profileImageUrl,
        coverImageUrl,
        displayName,
        profileFollowersCount: profile.followersCount,
        profileFollowingCount: profile.followingCount,
        selected_targets: targets,
      },
    }
  }

  getProviderName(): string {
    return 'apify'
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0
  }

  private resolveTargets(options?: TwitterScrapeOptions): TwitterScrapeTargets {
    const requested = options?.targets
    if (!requested) return { ...DEFAULT_TARGETS }
    return {
      profile: !!requested.profile,
      tweets: !!requested.tweets,
      replies: !!requested.replies,
      followers: !!requested.followers,
      following: !!requested.following,
    }
  }

  private async scrapeTimeline(
    username: string,
    maxItems: number,
    onProgress?: (progress: TimelineProgress) => Promise<void>,
    shouldCancel?: () => Promise<boolean> | boolean,
    apifyWebhook?: TwitterScrapeOptions['apifyWebhook'],
  ): Promise<TimelineScrape> {
    console.log(`[Apify] Scraping timeline/profile for @${username} (maxItems=${maxItems})`)

    try {
      const run = await this.client.actor(this.profileActorId).start(
        {
          twitterHandles: [username],
          maxItems: Math.max(1, maxItems),
        },
        this.buildRunWebhooks(apifyWebhook, 'timeline'),
      )

      if (!run.id || !run.defaultDatasetId) {
        throw new Error('Apify profile scraper did not return run metadata.')
      }
      if (onProgress) {
        await onProgress({
          tweets: 0,
          replies: 0,
          totalItems: 0,
          runId: run.id,
        })
      }

      const normalizedItems: Record<string, unknown>[] = []
      const tweets: Tweet[] = []
      const replies: Tweet[] = []
      const seenTweetIds = new Set<string>()
      let processedItems = 0
      let nextEmitAt = PROGRESS_UPDATE_ITEM_INTERVAL
      let hasInitialProgressEmission = false

      const polled = await this.pollRunDatasetItems({
        runId: run.id,
        datasetId: run.defaultDatasetId,
        maxItems: Math.max(1, maxItems),
        shouldCancel,
        onBatch: async (batch) => {
          for (const item of batch) {
            normalizedItems.push(item)
            processedItems += 1

            const mapped = this.mapTimelineItem(item, username)
            if (!mapped.id || seenTweetIds.has(mapped.id)) continue
            seenTweetIds.add(mapped.id)
            if (this.isReplyItem(item, mapped)) {
              replies.push(mapped)
            } else {
              tweets.push(mapped)
            }

            if (onProgress && processedItems >= nextEmitAt) {
              hasInitialProgressEmission = true
              await onProgress({
                tweets: tweets.length,
                replies: replies.length,
                totalItems: processedItems,
              })
              nextEmitAt += PROGRESS_UPDATE_ITEM_INTERVAL
            } else if (onProgress && !hasInitialProgressEmission && processedItems > 0) {
              hasInitialProgressEmission = true
              await onProgress({
                tweets: tweets.length,
                replies: replies.length,
                totalItems: processedItems,
              })
              nextEmitAt = Math.max(PROGRESS_UPDATE_ITEM_INTERVAL, processedItems + PROGRESS_UPDATE_ITEM_INTERVAL)
            }
          }
        },
      })

      if (polled.finalStatus !== 'SUCCEEDED') {
        throw new Error(`Apify profile scraper finished with status ${polled.finalStatus}.`)
      }

      if (onProgress && processedItems > 0) {
        await onProgress({
          tweets: tweets.length,
          replies: replies.length,
          totalItems: processedItems,
        })
      }

      return {
        tweets,
        replies,
        profile: this.extractProfileMetadata(normalizedItems, username),
        totalItems: normalizedItems.length,
      }
    } catch (error) {
      if (error instanceof RunCancelledError) {
        throw error
      }
      console.error('[Apify] Error scraping timeline/profile:', error)
      throw new Error(`Failed to scrape timeline/profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async scrapeSocialGraph(
    username: string,
    targets: { followers: boolean; following: boolean },
    maxItems?: number,
    onProgress?: (progress: SocialGraphProgress) => Promise<void>,
    shouldCancel?: () => Promise<boolean> | boolean,
    apifyWebhook?: TwitterScrapeOptions['apifyWebhook'],
  ): Promise<SocialGraphScrape> {
    console.log(`[Apify] Scraping social graph for @${username}`, {
      ...targets,
      maxItems: typeof maxItems === 'number' ? maxItems : 'default',
    })

    try {
      const actorInput: Record<string, unknown> = {
        twitterHandles: [username],
        getFollowers: targets.followers,
        getFollowing: targets.following,
        getRetweeters: false,
        includeUnavailableUsers: false,
      }
      if (typeof maxItems === 'number' && Number.isFinite(maxItems) && maxItems > 0) {
        actorInput.maxItems = Math.floor(maxItems)
      }

      const run = await this.client.actor(this.userActorId).start(
        actorInput,
        this.buildRunWebhooks(apifyWebhook, 'social_graph'),
      )
      if (!run.id || !run.defaultDatasetId) {
        throw new Error('Apify user scraper did not return run metadata.')
      }
      if (onProgress) {
        await onProgress({
          followers: 0,
          following: 0,
          totalItems: 0,
          runId: run.id,
        })
      }

      const normalizedItems: Record<string, unknown>[] = []
      const pendingUserItems: Record<string, unknown>[] = []
      const progressFollowers: SocialUser[] = []
      const progressFollowing: SocialUser[] = []
      const seenFollowerKeys = new Set<string>()
      const seenFollowingKeys = new Set<string>()
      const requestedHandle = this.normalizeHandle(username)
      let owner: Record<string, unknown> | null = null
      let firstUserCandidate: Record<string, unknown> | null = null
      let processedItems = 0
      let nextEmitAt = PROGRESS_UPDATE_ITEM_INTERVAL
      let hasInitialProgressEmission = false

      const addUserIfNew = (
        candidate: Record<string, unknown>,
        seen: Set<string>,
        collection: SocialUser[],
      ) => {
        const user = this.toSocialUser(candidate)
        if (!user) return
        const key = `${user.user_id}:${(user.username || '').toLowerCase()}`
        if (seen.has(key)) return
        seen.add(key)
        collection.push(user)
      }

      const tryResolveOwner = (item: Record<string, unknown>) => {
        if (owner) return
        const type = (item.type as string | undefined)?.toLowerCase()
        if (type !== 'user') return
        if (!firstUserCandidate) firstUserCandidate = item

        const inputSource = this.normalizeHandle(item.inputSource as string | undefined)
        const userName = this.normalizeHandle(item.userName as string | undefined)
        if (inputSource === requestedHandle || userName === requestedHandle) {
          owner = item
        }
      }

      const processCandidate = (item: Record<string, unknown>) => {
        const type = (item.type as string | undefined)?.toLowerCase()
        if (type !== 'user') return

        tryResolveOwner(item)
        if (!owner) {
          pendingUserItems.push(item)
          return
        }

        const ownerUsername = this.normalizeHandle(
          (owner.userName as string | undefined) || username,
        )
        const ownerId = String(owner.id || '').trim()
        const candidateId = String(item.id || '').trim()
        const candidateUsername = this.normalizeHandle(item.userName as string | undefined)
        const followedBy = this.normalizeHandle(item.followedBy as string | undefined)

        if ((ownerId && candidateId === ownerId) || candidateUsername === ownerUsername) {
          return
        }

        if (targets.following && followedBy && followedBy === ownerUsername) {
          addUserIfNew(item, seenFollowingKeys, progressFollowing)
          return
        }

        if (targets.followers && (!followedBy || followedBy !== ownerUsername)) {
          addUserIfNew(item, seenFollowerKeys, progressFollowers)
        }
      }

      const polled = await this.pollRunDatasetItems({
        runId: run.id,
        datasetId: run.defaultDatasetId,
        maxItems,
        shouldCancel,
        onBatch: async (batch) => {
          for (const item of batch) {
            normalizedItems.push(item)
            processedItems += 1
            processCandidate(item)

            if (owner && pendingUserItems.length > 0) {
              const deferred = pendingUserItems.splice(0, pendingUserItems.length)
              deferred.forEach((candidate) => processCandidate(candidate))
            }

            if (onProgress && processedItems >= nextEmitAt) {
              hasInitialProgressEmission = true
              await onProgress({
                followers: progressFollowers.length,
                following: progressFollowing.length,
                totalItems: processedItems,
              })
              nextEmitAt += PROGRESS_UPDATE_ITEM_INTERVAL
            } else if (onProgress && !hasInitialProgressEmission && processedItems > 0) {
              hasInitialProgressEmission = true
              await onProgress({
                followers: progressFollowers.length,
                following: progressFollowing.length,
                totalItems: processedItems,
              })
              nextEmitAt = Math.max(PROGRESS_UPDATE_ITEM_INTERVAL, processedItems + PROGRESS_UPDATE_ITEM_INTERVAL)
            }
          }
        },
      })

      if (polled.finalStatus !== 'SUCCEEDED') {
        throw new Error(`Apify user scraper finished with status ${polled.finalStatus}.`)
      }

      if (!owner && firstUserCandidate) {
        owner = firstUserCandidate
      }
      if (owner && pendingUserItems.length > 0) {
        const deferred = pendingUserItems.splice(0, pendingUserItems.length)
        deferred.forEach((candidate) => processCandidate(candidate))
      }

      const finalFollowers = targets.followers ? this.extractFollowers(normalizedItems, username) : []
      const finalFollowing = targets.following ? this.extractFollowing(normalizedItems, username) : []

      if (onProgress) {
        await onProgress({
          followers: finalFollowers.length,
          following: finalFollowing.length,
          totalItems: normalizedItems.length,
        })
      }

      return {
        followers: finalFollowers,
        following: finalFollowing,
        profile: this.extractProfileFromSocialGraph(normalizedItems, username),
        totalItems: normalizedItems.length,
      }
    } catch (error) {
      if (error instanceof RunCancelledError) {
        throw error
      }
      console.error('[Apify] Error scraping followers/following:', error)
      throw new Error(`Failed to scrape followers/following: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private mapTimelineItem(item: Record<string, unknown>, fallbackUsername: string): Tweet {
    const author = (item.author as Record<string, unknown> | undefined) || {}
    const authorUsername =
      (author.userName as string | undefined) ||
      (author.username as string | undefined) ||
      (item.userName as string | undefined) ||
      fallbackUsername
    const authorName = (author.name as string | undefined) || authorUsername
    const rawAuthorImage =
      (author.profilePicture as string | undefined) ||
      (author.profileImageUrl as string | undefined) ||
      (author.profile_image_url_https as string | undefined) ||
      (author.profile_image_url as string | undefined)

    const media = this.extractMedia(item)
    const itemUrl = (item.url as string | undefined) || `https://x.com/${authorUsername}/status/${String(item.id || '')}`

    return {
      id: String(item.id || item.id_str || ''),
      text: String(item.text || item.fullText || ''),
      created_at: String(item.createdAt || item.created_at || ''),
      retweet_count: this.asNumber(item.retweetCount ?? item.retweet_count),
      favorite_count: this.asNumber(item.likeCount ?? item.favorite_count),
      reply_count: this.asNumber(item.replyCount ?? item.reply_count),
      type: typeof item.type === 'string' ? item.type : undefined,
      in_reply_to_status_id: this.asNullableString(
        item.inReplyToStatusId ??
          item.in_reply_to_status_id ??
          item.in_reply_to_status_id_str,
      ),
      in_reply_to_user_id: this.asNullableString(
        item.inReplyToUserId ??
          item.in_reply_to_user_id ??
          item.in_reply_to_user_id_str,
      ),
      in_reply_to_screen_name: this.asNullableString(
        item.inReplyToUser ??
          item.in_reply_to_screen_name,
      ),
      tweet_url: itemUrl,
      author: {
        username: authorUsername,
        name: authorName,
        profileImageUrl: this.normalizeProfileImageUrl(rawAuthorImage),
      },
      media: media.length > 0 ? media : undefined,
    }
  }

  private extractMedia(item: Record<string, unknown>): TweetMedia[] {
    const mediaCandidates: unknown[] = []
    const seen = new Set<string>()
    const extendedEntities = item.extendedEntities as Record<string, unknown> | undefined
    const legacyExtendedEntities = item.extended_entities as Record<string, unknown> | undefined
    const entities = item.entities as Record<string, unknown> | undefined

    if (Array.isArray(extendedEntities?.media)) mediaCandidates.push(...extendedEntities.media)
    if (Array.isArray(legacyExtendedEntities?.media)) mediaCandidates.push(...legacyExtendedEntities.media)
    if (Array.isArray(entities?.media)) mediaCandidates.push(...entities.media)

    return mediaCandidates
      .map((mediaItem) => this.mapMediaItem(mediaItem as Record<string, unknown>))
      .filter((media): media is TweetMedia => {
        if (!media) return false
        const key = `${media.type}:${media.media_url || media.url}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  private mapMediaItem(mediaItem: Record<string, unknown>): TweetMedia | null {
    const rawType = String(mediaItem.type || '')
    const type: TweetMedia['type'] =
      rawType === 'photo' || rawType === 'video' || rawType === 'animated_gif'
        ? rawType
        : 'photo'

    const videoInfo = mediaItem.video_info as Record<string, unknown> | undefined
    const variants = Array.isArray(videoInfo?.variants) ? (videoInfo.variants as Record<string, unknown>[]) : []
    const bestVideoVariant = variants
      .filter((variant) => typeof variant.url === 'string' && `${variant.content_type || ''}`.toLowerCase().includes('mp4'))
      .sort((a, b) => this.asNumber(b.bitrate) - this.asNumber(a.bitrate))[0]

    const previewImageUrl =
      (mediaItem.media_url_https as string | undefined) ||
      (mediaItem.media_url as string | undefined)
    const bestVideoUrl = bestVideoVariant?.url as string | undefined
    const fallbackUrl = mediaItem.url as string | undefined

    const mediaUrl =
      type === 'photo'
        ? (previewImageUrl || fallbackUrl)
        : (bestVideoUrl || previewImageUrl || fallbackUrl)

    if (!mediaUrl) return null

    const normalizedMediaUrl = mediaUrl.replace(/&amp;/g, '&')
    const normalizedPreviewImageUrl = previewImageUrl?.replace(/&amp;/g, '&')

    return {
      url: String(fallbackUrl || mediaUrl),
      type,
      media_url: normalizedMediaUrl,
      media_url_https: normalizedPreviewImageUrl,
    }
  }

  private isReplyItem(item: Record<string, unknown>, mappedTweet: Tweet): boolean {
    if (item.type === 'reply' || item.isReply === true) return true
    return Boolean(
      mappedTweet.in_reply_to_status_id ||
      mappedTweet.in_reply_to_user_id ||
      mappedTweet.in_reply_to_screen_name,
    )
  }

  private extractProfileMetadata(items: Record<string, unknown>[], fallbackUsername: string): ProfileMetadata {
    const firstWithAuthor = items.find((item) => {
      const author = item.author as Record<string, unknown> | undefined
      return Boolean(author && (author.name || author.userName || author.profilePicture || author.coverPicture))
    })

    const author = (firstWithAuthor?.author as Record<string, unknown> | undefined) || {}
    const rawProfileImage =
      (author.profilePicture as string | undefined) ||
      (author.profileImageUrl as string | undefined) ||
      (author.profile_image_url_https as string | undefined) ||
      (author.profile_image_url as string | undefined)
    const rawCoverImage =
      (author.coverPicture as string | undefined) ||
      (author.profileBannerUrl as string | undefined) ||
      (author.profile_banner_url as string | undefined)

    return {
      profileImageUrl: this.normalizeProfileImageUrl(rawProfileImage),
      coverImageUrl: this.normalizeCoverImageUrl(rawCoverImage),
      displayName:
        (author.name as string | undefined) ||
        (firstWithAuthor?.authorName as string | undefined) ||
        fallbackUsername,
      followersCount: this.readOptionalCount(
        author.followersCount ??
          author.followers_count ??
          author.followers,
      ),
      followingCount: this.readOptionalCount(
        author.followingCount ??
          author.following_count ??
          author.friendsCount ??
          author.friends_count ??
          author.following ??
          author.friends,
      ),
    }
  }

  private extractUsersByRelation(items: Record<string, unknown>[], includeCandidate: (item: Record<string, unknown>) => boolean): SocialUser[] {
    const seen = new Set<string>()
    const users: SocialUser[] = []

    const addCandidate = (candidate: Record<string, unknown>) => {
      const user = this.toSocialUser(candidate)
      if (!user) return
      const uniqueKey = `${user.user_id}:${user.username || ''}`.toLowerCase()
      if (seen.has(uniqueKey)) return
      seen.add(uniqueKey)
      users.push(user)
    }

    items.forEach((item) => {
      if (includeCandidate(item)) {
        addCandidate(item)
      }
    })

    return users
  }

  private toSocialUser(candidate: Record<string, unknown>): SocialUser | null {
    const userId = String(candidate.id || candidate.userId || candidate.accountId || '').trim()
    const screenName = String(candidate.screenName || candidate.userName || candidate.username || '').trim()
    if (!userId && !screenName) return null

    const name = String(candidate.name || screenName || userId || 'Unknown').trim()
    const profileImageUrl =
      (candidate.profileImageUrl as string | undefined) ||
      (candidate.profilePicture as string | undefined) ||
      undefined

    const userLink = screenName
      ? `https://x.com/${screenName}`
      : `https://twitter.com/intent/user?user_id=${userId}`

    return {
      user_id: userId || screenName,
      username: screenName || undefined,
      name,
      userLink,
      profileImageUrl,
    }
  }

  private extractFollowing(items: Record<string, unknown>[], username: string): SocialUser[] {
    const owner = this.findOwnerUser(items, username)
    const ownerUsername = this.normalizeHandle(
      (owner?.userName as string | undefined) ||
      username,
    )

    return this.extractUsersByRelation(items, (item) => {
      const type = (item.type as string | undefined)?.toLowerCase()
      if (type !== 'user') return false

      const followedBy = this.normalizeHandle(item.followedBy as string | undefined)
      if (!followedBy || followedBy !== ownerUsername) return false

      const candidateUsername = this.normalizeHandle(item.userName as string | undefined)
      return candidateUsername !== ownerUsername
    })
  }

  private extractFollowers(items: Record<string, unknown>[], username: string): SocialUser[] {
    const owner = this.findOwnerUser(items, username)
    const ownerUsername = this.normalizeHandle(
      (owner?.userName as string | undefined) ||
      username,
    )
    const ownerId = String(owner?.id || '').trim()

    return this.extractUsersByRelation(items, (item) => {
      const type = (item.type as string | undefined)?.toLowerCase()
      if (type !== 'user') return false

      const candidateId = String(item.id || '').trim()
      const candidateUsername = this.normalizeHandle(item.userName as string | undefined)
      const followedBy = this.normalizeHandle(item.followedBy as string | undefined)

      // "Following" rows explicitly carry followedBy=owner, so exclude them.
      if (followedBy && followedBy === ownerUsername) return false
      // Exclude the owner row itself.
      if ((ownerId && candidateId === ownerId) || candidateUsername === ownerUsername) return false

      return true
    })
  }

  private extractProfileFromSocialGraph(items: Record<string, unknown>[], username: string): ProfileMetadata {
    const owner = this.findOwnerUser(items, username)
    if (!owner) return {}

    return {
      profileImageUrl: this.normalizeProfileImageUrl(owner.profilePicture as string | undefined),
      coverImageUrl: this.normalizeCoverImageUrl(owner.coverPicture as string | undefined),
      displayName:
        (owner.name as string | undefined) ||
        (owner.userName as string | undefined) ||
        username,
      followersCount: this.readOptionalCount(owner.followers),
      followingCount: this.readOptionalCount(owner.following),
    }
  }

  private findOwnerUser(items: Record<string, unknown>[], username: string): Record<string, unknown> | null {
    const requested = this.normalizeHandle(username)
    const candidates = items.filter((item) => (item.type as string | undefined)?.toLowerCase() === 'user')

    // Most datasets include owner as the first row with inputSource=requested handle.
    const byInputSource = candidates.find((item) => this.normalizeHandle(item.inputSource as string | undefined) === requested)
    if (byInputSource) return byInputSource

    const byUserName = candidates.find((item) => this.normalizeHandle(item.userName as string | undefined) === requested)
    if (byUserName) return byUserName

    return candidates[0] || null
  }

  private normalizeProfileImageUrl(url?: string): string | undefined {
    if (!url) return undefined
    return url.replace('_normal.', '_400x400.')
  }

  private normalizeCoverImageUrl(url?: string): string | undefined {
    if (!url) return undefined
    const [base, query] = url.split('?')
    if (/\/\d+x\d+$/.test(base)) return url
    const withSize = `${base}/1500x500`
    return query ? `${withSize}?${query}` : withSize
  }

  private asNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return 0
  }

  private asNullableString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number') return String(value)
    return null
  }

  private readOptionalCount(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  private buildRunWebhooks(
    webhook: TwitterScrapeOptions['apifyWebhook'] | undefined,
    runType: 'timeline' | 'social_graph',
  ) {
    if (!webhook) return undefined
    const baseUrl = webhook.baseUrl.trim().replace(/\/+$/, '')
    const jobId = webhook.jobId.trim()
    if (!baseUrl || !jobId) return undefined
    if (!/^https?:\/\//i.test(baseUrl)) return undefined

    const requestUrl = new URL('/api/platforms/twitter/apify-webhook', baseUrl)
    requestUrl.searchParams.set('jobId', jobId)
    requestUrl.searchParams.set('runType', runType)
    if (webhook.token && webhook.token.trim().length > 0) {
      requestUrl.searchParams.set('token', webhook.token.trim())
    }

    return {
      webhooks: [
        {
          eventTypes: [...APIFY_TERMINAL_WEBHOOK_EVENTS],
          requestUrl: requestUrl.toString(),
          doNotRetry: false,
          idempotencyKey: `${jobId}-${runType}-${Date.now()}`,
        },
      ],
    }
  }

  private normalizeHandle(handle?: string): string {
    return (handle || '').replace(/^@/, '').trim().toLowerCase()
  }

  private isRunTerminalStatus(status: string | undefined): boolean {
    const normalized = (status || '').toUpperCase()
    return normalized === 'SUCCEEDED'
      || normalized === 'FAILED'
      || normalized === 'ABORTED'
      || normalized === 'TIMED-OUT'
  }

  private async pollRunDatasetItems(params: {
    runId: string
    datasetId: string
    maxItems?: number
    shouldCancel?: () => Promise<boolean> | boolean
    onBatch?: (batch: Record<string, unknown>[]) => Promise<void>
  }): Promise<RunDatasetPollResult> {
    const { runId, datasetId, maxItems, shouldCancel, onBatch } = params
    const pageSize = 1000
    const allItems: Record<string, unknown>[] = []
    const runClient = this.client.run(runId)
    const datasetClient = this.client.dataset(datasetId)
    let offset = 0
    let currentStatus: string | undefined

    const abortRunAndThrow = async () => {
      try {
        await runClient.abort({ gracefully: false })
      } catch (abortError) {
        console.warn(`[Apify] Failed to abort run ${runId}:`, abortError)
      }
      throw new RunCancelledError()
    }

    const cancellationRequested = async () => {
      if (!shouldCancel) return false
      try {
        return Boolean(await shouldCancel())
      } catch {
        return false
      }
    }

    while (true) {
      if (await cancellationRequested()) {
        await abortRunAndThrow()
      }

      const remaining = typeof maxItems === 'number' && Number.isFinite(maxItems)
        ? Math.max(0, Math.floor(maxItems) - allItems.length)
        : Number.POSITIVE_INFINITY

      if (remaining <= 0) break

      const limit = Number.isFinite(remaining)
        ? Math.max(1, Math.min(pageSize, remaining))
        : pageSize

      const { items } = await datasetClient.listItems({ offset, limit })
      const batch = (items || []) as Record<string, unknown>[]

      if (batch.length > 0) {
        allItems.push(...batch)
        if (onBatch) {
          await onBatch(batch)
        }
        offset += batch.length
      }

      if (await cancellationRequested()) {
        await abortRunAndThrow()
      }

      const terminal = this.isRunTerminalStatus(currentStatus)
      if (terminal && batch.length === 0) {
        break
      }

      if (!terminal) {
        const run = await runClient.get({ waitForFinish: 2 })
        currentStatus = run?.status || currentStatus
      }

      if (terminal && batch.length > 0) {
        continue
      }
    }

    return {
      items: allItems,
      finalStatus: (currentStatus || 'SUCCEEDED').toUpperCase(),
    }
  }
}
