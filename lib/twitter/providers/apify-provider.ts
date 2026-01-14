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
  private actorId = 'apidojo/tweet-scraper' // Apify's Twitter scraper
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
      const run = await this.client.actor(this.actorId).call({
        searchTerms: [`from:${username}`],
        maxTweets: maxTweets,
        // Only get tweets, not replies or retweets for now
        getTweets: true,
        getReplies: false,
        getRetweets: false,
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
      // Run the Apify tweet-scraper actor for followers
      const run = await this.client.actor(this.actorId).call({
        searchTerms: [`from:${username}`],
        maxTweets: 1, // Just get profile data
        getFollowers: true,
        maxFollowers: 1000, // Limit to prevent excessive costs
      })

      // Get dataset items
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()

      // Extract followers from the first item (profile data)
      const followers: Follower[] = []
      if (items.length > 0 && items[0].followers) {
        items[0].followers.forEach((follower: any) => {
          followers.push({
            username: follower.screen_name || follower.username,
            user_id: follower.id_str || follower.id,
            name: follower.name,
          })
        })
      }

      console.log(`[Apify] Successfully scraped ${followers.length} followers`)
      return followers
    } catch (error) {
      console.error('[Apify] Error scraping followers:', error)
      // Don't throw, just return empty array (followers might not be critical)
      return []
    }
  }

  async scrapeFollowing(username: string): Promise<Following[]> {
    if (!this.isConfigured()) {
      throw new Error('Apify API key not configured')
    }

    console.log(`[Apify] Scraping following for @${username}`)

    try {
      // Run the Apify tweet-scraper actor for following
      const run = await this.client.actor(this.actorId).call({
        searchTerms: [`from:${username}`],
        maxTweets: 1, // Just get profile data
        getFollowing: true,
        maxFollowing: 1000, // Limit to prevent excessive costs
      })

      // Get dataset items
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()

      // Extract following from the first item (profile data)
      const following: Following[] = []
      if (items.length > 0 && items[0].following) {
        items[0].following.forEach((user: any) => {
          following.push({
            username: user.screen_name || user.username,
            user_id: user.id_str || user.id,
            name: user.name,
          })
        })
      }

      console.log(`[Apify] Successfully scraped ${following.length} following`)
      return following
    } catch (error) {
      console.error('[Apify] Error scraping following:', error)
      // Don't throw, just return empty array (following might not be critical)
      return []
    }
  }

  async scrapeAll(username: string, maxTweets: number = 3200): Promise<TwitterScrapeResult> {
    const startTime = Date.now()
    
    console.log(`[Apify] Starting full scrape for @${username}`)

    // Scrape all data
    const [tweets, followers, following] = await Promise.all([
      this.scrapeTweets(username, maxTweets),
      this.scrapeFollowers(username),
      this.scrapeFollowing(username),
    ])

    // Calculate cost based on Apify pricing
    // Base cost: ~$0.40 per 1,000 tweets
    const tweetCost = (tweets.length / 1000) * 0.4
    
    // Followers/following have minimal cost, estimate ~$0.10 total
    const followerCost = 0.05
    const followingCost = 0.05
    
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
          followers: followerCost,
          following: followingCost,
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
