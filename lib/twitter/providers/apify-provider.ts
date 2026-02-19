import { ApifyClient } from 'apify-client'
import { TwitterProvider } from '../twitter-provider.interface'
import {
  Follower,
  Following,
  Tweet,
  TweetMedia,
  TwitterScrapeOptions,
  TwitterScrapeResult,
  TwitterScrapeTargets,
} from '../types'

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
}

type SocialUser = {
  user_id: string
  username?: string
  name?: string
  userLink: string
  profileImageUrl?: string
}

const MAX_USER_GRAPH_ITEMS = 1000
const DEFAULT_TARGETS: TwitterScrapeTargets = {
  profile: true,
  tweets: true,
  replies: true,
  followers: true,
  following: true,
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
    const startTime = Date.now()

    console.log(`[Apify] Starting selective scrape for @${username}`, targets)

    let tweets: Tweet[] = []
    let replies: Tweet[] = []
    let followers: Follower[] = []
    let following: Following[] = []
    let profile: ProfileMetadata = {}
    let timelineItemCount = 0

    if (targets.profile || targets.tweets || targets.replies) {
      const timeline = await this.scrapeTimeline(username, maxTweets)
      timelineItemCount = timeline.totalItems
      if (targets.tweets) tweets = timeline.tweets
      if (targets.replies) replies = timeline.replies
      if (targets.profile) profile = timeline.profile
    }

    if (targets.followers || targets.following) {
      const graph = await this.scrapeSocialGraph(username, {
        followers: targets.followers,
        following: targets.following,
      })
      followers = graph.followers
      following = graph.following
      // Even when "profile" isn't explicitly selected, user-scraper returns the owner row.
      // Use it to keep profile display/counts accurate for followers/following-only snapshots.
      profile = {
        ...graph.profile,
        ...profile,
      }
    }

    const firstAuthor = [...tweets, ...replies].find((item) => item.author?.name || item.author?.profileImageUrl)?.author
    const profileImageUrl = profile.profileImageUrl || firstAuthor?.profileImageUrl
    const coverImageUrl = profile.coverImageUrl
    const displayName = profile.displayName || firstAuthor?.name || username

    // Approximate cost model using returned item counts.
    const tweetCost = (tweets.length / 1000) * 0.4
    const replyCost = (replies.length / 1000) * 0.4
    const followerCost = (followers.length / 1000) * 0.4
    const followingCost = (following.length / 1000) * 0.4
    const profileCost = targets.profile && !targets.tweets && !targets.replies ? (timelineItemCount / 1000) * 0.4 : 0
    const totalCost = tweetCost + replyCost + followerCost + followingCost + profileCost

    const timelineRequested = targets.tweets || targets.replies
    const timelineReturned = tweets.length + replies.length

    console.log('[Apify] Selective scrape complete', {
      tweets: tweets.length,
      replies: replies.length,
      followers: followers.length,
      following: following.length,
      elapsedMs: Date.now() - startTime,
    })

    return {
      tweets,
      replies,
      followers,
      following,
      cost: {
        provider: 'apify',
        total_cost: parseFloat(totalCost.toFixed(2)),
        tweets_count: timelineReturned,
        breakdown: {
          tweets: parseFloat(tweetCost.toFixed(2)),
          replies: parseFloat(replyCost.toFixed(2)),
          profile: parseFloat(profileCost.toFixed(2)),
          followers: parseFloat(followerCost.toFixed(2)),
          following: parseFloat(followingCost.toFixed(2)),
        },
      },
      metadata: {
        username,
        scraped_at: new Date().toISOString(),
        is_partial: timelineRequested ? timelineReturned < maxTweets : false,
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

  private async scrapeTimeline(username: string, maxItems: number): Promise<TimelineScrape> {
    console.log(`[Apify] Scraping timeline/profile for @${username} (maxItems=${maxItems})`)

    try {
      const run = await this.client.actor(this.profileActorId).call({
        twitterHandles: [username],
        maxItems: Math.max(1, maxItems),
      })

      if (run.status === 'FAILED') {
        throw new Error('Apify profile scraper run failed. Verify your Apify account plan and actor access.')
      }

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()
      const normalizedItems = (items || []) as Record<string, unknown>[]
      const tweets: Tweet[] = []
      const replies: Tweet[] = []
      const seenTweetIds = new Set<string>()

      normalizedItems.forEach((item) => {
        const mapped = this.mapTimelineItem(item, username)
        if (!mapped.id || seenTweetIds.has(mapped.id)) return
        seenTweetIds.add(mapped.id)
        if (this.isReplyItem(item, mapped)) {
          replies.push(mapped)
          return
        }
        tweets.push(mapped)
      })

      return {
        tweets,
        replies,
        profile: this.extractProfileMetadata(normalizedItems, username),
        totalItems: normalizedItems.length,
      }
    } catch (error) {
      console.error('[Apify] Error scraping timeline/profile:', error)
      throw new Error(`Failed to scrape timeline/profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async scrapeSocialGraph(
    username: string,
    targets: { followers: boolean; following: boolean },
  ): Promise<SocialGraphScrape> {
    console.log(`[Apify] Scraping social graph for @${username}`, targets)

    try {
      const run = await this.client.actor(this.userActorId).call({
        twitterHandles: [username],
        getFollowers: targets.followers,
        getFollowing: targets.following,
        getRetweeters: false,
        includeUnavailableUsers: false,
        maxItems: MAX_USER_GRAPH_ITEMS,
      })

      if (run.status === 'FAILED') {
        throw new Error('Apify user scraper run failed. Verify your Apify account plan and actor access.')
      }

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()
      const normalizedItems = (items || []) as Record<string, unknown>[]

      return {
        followers: targets.followers ? this.extractFollowers(normalizedItems, username) : [],
        following: targets.following ? this.extractFollowing(normalizedItems, username) : [],
        profile: this.extractProfileFromSocialGraph(normalizedItems, username),
      }
    } catch (error) {
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
      const userId = String(candidate.id || candidate.userId || candidate.accountId || '').trim()
      const screenName = String(candidate.screenName || candidate.userName || candidate.username || '').trim()
      const uniqueKey = `${userId}:${screenName}`.toLowerCase()
      if (!userId && !screenName) return
      if (seen.has(uniqueKey)) return
      seen.add(uniqueKey)

      const name = String(candidate.name || screenName || userId || 'Unknown').trim()
      const profileImageUrl =
        (candidate.profileImageUrl as string | undefined) ||
        (candidate.profilePicture as string | undefined) ||
        undefined

      const userLink = screenName
        ? `https://x.com/${screenName}`
        : `https://twitter.com/intent/user?user_id=${userId}`

      users.push({
        user_id: userId || screenName,
        username: screenName || undefined,
        name,
        userLink,
        profileImageUrl,
      })
    }

    items.forEach((item) => {
      if (includeCandidate(item)) {
        addCandidate(item)
      }
    })

    return users
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

  private normalizeHandle(handle?: string): string {
    return (handle || '').replace(/^@/, '').trim().toLowerCase()
  }
}
