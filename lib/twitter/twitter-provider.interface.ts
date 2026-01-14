import { Tweet, Follower, Following, TwitterScrapeResult } from './types'

/**
 * Abstract interface that all Twitter scraping providers must implement
 * This allows easy switching between Apify, Twitter API, or custom scrapers
 */
export interface TwitterProvider {
  /**
   * Scrape tweets from a user's timeline
   * @param username - Twitter username (without @)
   * @param maxTweets - Maximum number of tweets to fetch
   * @returns Array of tweets
   */
  scrapeTweets(username: string, maxTweets: number): Promise<Tweet[]>

  /**
   * Scrape a user's followers list
   * @param username - Twitter username (without @)
   * @returns Array of followers
   */
  scrapeFollowers(username: string): Promise<Follower[]>

  /**
   * Scrape a user's following list
   * @param username - Twitter username (without @)
   * @returns Array of accounts the user follows
   */
  scrapeFollowing(username: string): Promise<Following[]>

  /**
   * Scrape all data at once (tweets, followers, following)
   * This is the main method most code should use
   * @param username - Twitter username (without @)
   * @param maxTweets - Maximum number of tweets to fetch
   * @returns Complete scrape result with all data and cost info
   */
  scrapeAll(username: string, maxTweets: number): Promise<TwitterScrapeResult>

  /**
   * Get the provider name
   */
  getProviderName(): string

  /**
   * Check if the provider is properly configured
   */
  isConfigured(): boolean
}
