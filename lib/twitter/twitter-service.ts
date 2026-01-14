import { TwitterProvider } from './twitter-provider.interface'
import { ApifyProvider } from './providers/apify-provider'
import { TwitterApiProvider } from './providers/twitter-api-provider'

/**
 * Factory function to get the appropriate Twitter provider
 * Based on the TWITTER_SCRAPE_PROVIDER environment variable
 * 
 * Defaults to 'apify' for now
 * 
 * Usage:
 *   const twitter = getTwitterProvider()
 *   const result = await twitter.scrapeAll('elonmusk', 3200)
 */
export function getTwitterProvider(): TwitterProvider {
  const provider = process.env.TWITTER_SCRAPE_PROVIDER || 'apify'

  console.log(`[TwitterService] Using provider: ${provider}`)

  switch (provider) {
    case 'apify':
      return new ApifyProvider()
    
    case 'twitter-api':
      return new TwitterApiProvider()
    
    default:
      console.warn(`Unknown provider: ${provider}, falling back to Apify`)
      return new ApifyProvider()
  }
}

/**
 * Validate that a provider is properly configured
 * Useful for checking before running scrapes
 */
export async function validateProvider(): Promise<{ valid: boolean; message: string }> {
  try {
    const provider = getTwitterProvider()
    
    if (!provider.isConfigured()) {
      return {
        valid: false,
        message: `${provider.getProviderName()} is not properly configured. Check your environment variables.`,
      }
    }

    return {
      valid: true,
      message: `${provider.getProviderName()} is ready`,
    }
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Re-export types for convenience
export * from './types'
export type { TwitterProvider } from './twitter-provider.interface'
