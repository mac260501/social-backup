import { TwitterProvider } from '../twitter-provider.interface'
import { Tweet, Follower, Following, TwitterScrapeResult } from '../types'

/**
 * Twitter Official API Provider
 * Uses Twitter's official API v2
 * Pricing: $100/month (Basic tier) or $5,000/month (Pro tier)
 * 
 * NOT IMPLEMENTED YET - This is a placeholder for future migration
 */
export class TwitterApiProvider implements TwitterProvider {
  private apiKey: string
  private apiSecret: string
  private bearerToken: string

  constructor() {
    this.apiKey = process.env.TWITTER_API_KEY || ''
    this.apiSecret = process.env.TWITTER_API_SECRET || ''
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN || ''
  }

  async scrapeTweets(username: string, maxTweets: number): Promise<Tweet[]> {
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeFollowers(username: string): Promise<Follower[]> {
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeFollowing(username: string): Promise<Following[]> {
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeAll(username: string, maxTweets: number): Promise<TwitterScrapeResult> {
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  getProviderName(): string {
    return 'twitter-api'
  }

  isConfigured(): boolean {
    return !!this.bearerToken && this.bearerToken.length > 0
  }
}
