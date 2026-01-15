import { TwitterProvider } from '../twitter-provider.interface'
import { Tweet, Follower, Following, TwitterScrapeResult } from '../types'
import { ApifyClient } from 'apify-client'

/**
 * Apify Twitter Scraper Provider
 * Uses Apify's tweet-scraper actor for data extraction
 * Pricing: ~$0.40 per 1,000 tweets
 */
export class ApifyProvider implements TwitterProvider {
  private apiKey: string
  private tweetActorId = 'apidojo/tweet-scraper' // For scraping tweets
  private userActorId = 'apidojo/twitter-user-scraper' // For scraping followers/following
  private client: ApifyClient

  constructor() {
    this.apiKey = process.env.APIFY_API_KEY || ''
    this.client = new ApifyClient({ token: this.apiKey })
  }

  async scrapeTweets(username: string, maxTweets: number): Promise<Tweet[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }

    console.log(`[Apify] Scraping ${maxTweets} tweets for @${username}`)

    try {
      // Run the Apify tweet-scraper actor
      const run = await this.client.actor(this.tweetActorId).call({
        searchTerms: [`from:${username}`],
        maxTweets: maxTweets,
        // Get all content: tweets, replies, and retweets
        getTweets: true,
        getReplies: true,
        getRetweets: true,
      })

      // Check if the run failed
      if (run.status === 'FAILED') {
        throw new Error('Apify run failed. You may need a paid Apify plan to use this actor. Please check: https://apify.com/pricing')
      }

      // Get dataset items (tweets)
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()

      // If no items returned, check if it's a plan limitation
      if (!items || items.length === 0) {
        console.warn('[Apify] No tweets returned - this may be due to Apify plan limitations')
        throw new Error('No tweets returned. This actor requires a paid Apify plan. Visit: https://apify.com/pricing')
      }

      // Transform Apify format to our standard format
      const tweets: Tweet[] = items.map((item: any) => ({
        id: item.id || item.id_str,
        text: item.full_text || item.text || '',
        created_at: item.created_at,
        retweet_count: item.retweet_count || 0,
        favorite_count: item.favorite_count || 0,
        reply_count: item.reply_count || 0,
        author: {
          username: item.user?.screen_name || username,
          name: item.user?.name || '',
        },
      }))

      console.log(`[Apify] Successfully scraped ${tweets.length} tweets`)
      return tweets
    } catch (error) {
      console.error('[Apify] Error scraping tweets:', error)

      // Check for specific Apify errors
      if (error instanceof Error && error.message.includes('Free Plan')) {
        throw new Error('Apify scraping requires a paid plan ($49/month). Please upgrade at https://apify.com/pricing or use the free archive upload method instead.')
      }

      throw new Error(`Failed to scrape tweets: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async scrapeFollowers(username: string): Promise<Follower[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }

    console.log(`[Apify] Scraping followers for @${username}`)

    try {
      // Run the Apify user-scraper actor with getFollowers enabled
      const run = await this.client.actor(this.userActorId).call({
        twitterHandles: [username],
        getFollowers: true,
        getFollowing: false,  // Only get followers, not following
        maxItems: 1000,  // Limit to reasonable number
      })

      // Check if the run failed
      if (run.status === 'FAILED') {
        throw new Error('Apify run failed. You may need a paid Apify plan to use this actor.')
      }

      // Get dataset items (followers)
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()

      if (!items || items.length === 0) {
        console.warn('[Apify] No followers returned')
        return []
      }

      // Transform Apify format to our standard format
      // Filter out: empty items, items without userName, and the first item (user's own profile)
      const followers: Follower[] = items
        .slice(1) // Skip first item (user's own profile)
        .filter((item: any) => item && item.userName && item.id)
        .map((item: any) => ({
          username: item.userName,
          user_id: item.id?.toString(),
          name: item.name || item.userName,
        }))

      console.log(`[Apify] Successfully scraped ${followers.length} followers`)
      return followers
    } catch (error) {
      console.error('[Apify] Error scraping followers:', error)
      throw new Error(`Failed to scrape followers: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async scrapeFollowing(username: string): Promise<Following[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }

    console.log(`[Apify] Scraping following for @${username}`)

    try {
      // Run the Apify user-scraper actor with getFollowing enabled
      const run = await this.client.actor(this.userActorId).call({
        twitterHandles: [username],
        getFollowers: false,  // Only get following, not followers
        getFollowing: true,
        maxItems: 1000,  // Limit to reasonable number
      })

      // Check if the run failed
      if (run.status === 'FAILED') {
        throw new Error('Apify run failed. You may need a paid Apify plan to use this actor.')
      }

      // Get dataset items (following)
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()

      if (!items || items.length === 0) {
        console.warn('[Apify] No following returned')
        return []
      }

      // Transform Apify format to our standard format
      // Filter out: empty items, items without userName, and the first item (user's own profile)
      const following: Following[] = items
        .slice(1) // Skip first item (user's own profile)
        .filter((item: any) => item && item.userName && item.id)
        .map((item: any) => ({
          username: item.userName,
          user_id: item.id?.toString(),
          name: item.name || item.userName,
        }))

      console.log(`[Apify] Successfully scraped ${following.length} following`)
      return following
    } catch (error) {
      console.error('[Apify] Error scraping following:', error)
      throw new Error(`Failed to scrape following: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async scrapeAll(username: string, maxTweets: number = 3200): Promise<TwitterScrapeResult> {
    const startTime = Date.now()

    console.log(`[Apify] Starting full scrape for @${username}`)

    // Scrape all data: tweets, followers, and following
    const tweets = await this.scrapeTweets(username, maxTweets)
    const followers = await this.scrapeFollowers(username)
    const following = await this.scrapeFollowing(username)

    // Calculate cost based on Apify pricing
    // Tweet scraper: ~$0.40 per 1,000 tweets
    // User scraper: ~$0.40 per 1,000 users (for followers/following)
    const tweetCost = (tweets.length / 1000) * 0.4
    const followerCost = (followers.length / 1000) * 0.4
    const followingCost = (following.length / 1000) * 0.4
    const totalCost = tweetCost + followerCost + followingCost

    return {
      tweets,
      followers,
      following,
      cost: {
        provider: 'apify',
        total_cost: parseFloat(totalCost.toFixed(2)),
        tweets_count: tweets.length,
        breakdown: {
          tweets: parseFloat(tweetCost.toFixed(2)),
          followers: parseFloat(followerCost.toFixed(2)),
          following: parseFloat(followingCost.toFixed(2)),
        },
      },
      metadata: {
        username,
        scraped_at: new Date().toISOString(),
        is_partial: tweets.length < maxTweets,
        tweets_requested: maxTweets,
        tweets_received: tweets.length,
      },
    }
  }

  getProviderName(): string {
    return 'apify'
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0
  }
}
