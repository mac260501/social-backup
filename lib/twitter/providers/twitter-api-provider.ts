import { TwitterProvider } from '../twitter-provider.interface'
import { Tweet, Follower, Following, TwitterScrapeOptions, TwitterScrapeResult } from '../types'

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

  async scrapeTweets(_username: string, _maxTweets: number): Promise<Tweet[]> {
    void _username
    void _maxTweets
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeReplies(_username: string, _maxTweets: number): Promise<Tweet[]> {
    void _username
    void _maxTweets
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeFollowers(_username: string): Promise<Follower[]> {
    void _username
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeFollowing(_username: string): Promise<Following[]> {
    void _username
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeProfile(_username: string): Promise<{ profileImageUrl?: string; coverImageUrl?: string; displayName?: string }> {
    void _username
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  async scrapeAll(_username: string, _maxTweets: number, _options?: TwitterScrapeOptions): Promise<TwitterScrapeResult> {
    void _username
    void _maxTweets
    void _options
    throw new Error('Twitter API provider not implemented yet - use Apify for now')
  }

  getProviderName(): string {
    return 'twitter-api'
  }

  isConfigured(): boolean {
    return !!this.bearerToken && this.bearerToken.length > 0
  }
}
