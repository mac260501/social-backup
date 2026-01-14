# Twitter Scraping Abstraction Layer

This abstraction layer allows you to easily switch between different Twitter scraping providers (Apify, Twitter API, custom scrapers) without changing your application code.

## Architecture

```
Your App → TwitterService → Provider (Apify OR Twitter API)
```

## Files

- `types.ts` - Shared TypeScript types for all providers
- `twitter-provider.interface.ts` - Interface that all providers must implement
- `twitter-service.ts` - Main service and factory function
- `providers/apify-provider.ts` - Apify implementation
- `providers/twitter-api-provider.ts` - Twitter API implementation (placeholder)

## Usage

### Basic Usage

```typescript
import { getTwitterProvider } from '@/lib/twitter/twitter-service'

// Get the configured provider (Apify by default)
const twitter = getTwitterProvider()

// Scrape all data at once
const result = await twitter.scrapeAll('elonmusk', 3200)

console.log(`Scraped ${result.tweets.length} tweets`)
console.log(`Cost: $${result.cost.total_cost}`)
console.log(`Followers: ${result.followers.length}`)
```

### Individual Methods

```typescript
// Scrape just tweets
const tweets = await twitter.scrapeTweets('elonmusk', 1000)

// Scrape just followers
const followers = await twitter.scrapeFollowers('elonmusk')

// Scrape just following
const following = await twitter.scrapeFollowing('elonmusk')
```

### Validate Provider

```typescript
import { validateProvider } from '@/lib/twitter/twitter-service'

const { valid, message } = await validateProvider()
if (!valid) {
  console.error('Provider not configured:', message)
}
```

## Environment Variables

### For Apify (Current)

```bash
TWITTER_SCRAPE_PROVIDER=apify
APIFY_API_KEY=your_apify_api_key
```

### For Twitter API (Future)

```bash
TWITTER_SCRAPE_PROVIDER=twitter-api
TWITTER_BEARER_TOKEN=your_twitter_bearer_token
```

## Switching Providers

To switch from Apify to Twitter API:

1. Implement the Twitter API provider methods
2. Change one environment variable:
   ```bash
   TWITTER_SCRAPE_PROVIDER=twitter-api
   ```
3. That's it! No code changes needed.

## Cost Tracking

The abstraction layer automatically tracks costs:

```typescript
const result = await twitter.scrapeAll('user', 3200)

// Access cost information
console.log(result.cost)
// {
//   provider: 'apify',
//   total_cost: 1.25,
//   tweets_count: 3000,
//   breakdown: {
//     tweets: 1.20,
//     followers: 0.03,
//     following: 0.02
//   }
// }

// Save to database
await supabase.from('backups').insert({
  user_id: userId,
  backup_source: result.cost.provider,
  scrape_provider: result.cost.provider,
  scrape_cost: result.cost.total_cost,
  tweets_scraped: result.tweets.length,
  data: {
    tweets: result.tweets,
    followers: result.followers,
    following: result.following
  }
})
```

## Adding New Providers

To add a new provider:

1. Create a new file in `providers/`
2. Implement the `TwitterProvider` interface
3. Add it to the switch statement in `twitter-service.ts`
4. Update environment variables

## Next Steps for Implementation

Claude Code needs to:

1. Install Apify SDK: `npm install apify-client`
2. Implement the three methods in `apify-provider.ts`:
   - `scrapeTweets()` - Call Apify's tweet-scraper actor
   - `scrapeFollowers()` - Scrape followers list
   - `scrapeFollowing()` - Scrape following list
3. Create API endpoint `app/api/scrape/route.ts` that uses `getTwitterProvider()`
4. Add "Backup Now" button to dashboard that calls this API
5. Display scrape results and cost to user
