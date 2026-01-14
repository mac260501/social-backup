import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { getTwitterProvider } from '@/lib/twitter/twitter-service'

// Use service role for backend operations (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function createUuidFromString(str: string): string {
  const hash = createHash('sha256').update(str).digest('hex')
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join('-')
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, maxTweets, userId } = body

    if (!username) {
      return NextResponse.json({ success: false, error: 'Username is required' }, { status: 400 })
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 })
    }

    const userUuid = createUuidFromString(userId)
    const tweetsToScrape = maxTweets || 3200

    console.log(`[Scrape API] Starting scrape for @${username}, max tweets: ${tweetsToScrape}`)

    // Get the configured Twitter provider (Apify by default)
    const twitter = getTwitterProvider()

    // Check if provider is configured
    if (!twitter.isConfigured()) {
      return NextResponse.json({
        success: false,
        error: `${twitter.getProviderName()} is not configured. Please set up API keys.`,
      }, { status: 500 })
    }

    // Scrape all data
    const result = await twitter.scrapeAll(username, tweetsToScrape)

    console.log(`[Scrape API] Scrape completed:`, {
      tweets: result.tweets.length,
      followers: result.followers.length,
      following: result.following.length,
      cost: result.cost.total_cost,
    })

    // Save to Supabase
    const backupSnapshot = {
      user_id: userUuid,
      backup_name: `Scraped on ${new Date().toLocaleDateString()}`,
      backup_source: result.cost.provider,
      scrape_provider: result.cost.provider,
      scrape_cost: result.cost.total_cost,
      tweets_scraped: result.tweets.length,
      data: {
        tweets: result.tweets,
        followers: result.followers,
        following: result.following,
        likes: [], // Scraping doesn't get likes
        direct_messages: [], // Scraping doesn't get DMs
      },
      stats: {
        tweets: result.tweets.length,
        followers: result.followers.length,
        following: result.following.length,
        likes: 0,
        dms: 0,
      },
      file_size: 0, // No file for scraping
      archive_date: result.metadata.scraped_at,
    }

    const { data: insertedBackup, error: backupError } = await supabase
      .from('backups')
      .insert(backupSnapshot)
      .select()
      .single()

    if (backupError) {
      console.error('[Scrape API] Failed to save backup:', backupError)
      throw new Error(`Failed to save backup: ${backupError.message}`)
    }

    console.log('[Scrape API] Backup saved successfully:', insertedBackup.id)

    return NextResponse.json({
      success: true,
      message: 'Scrape completed successfully!',
      data: {
        tweets: result.tweets.length,
        followers: result.followers.length,
        following: result.following.length,
        cost: result.cost.total_cost,
        provider: result.cost.provider,
        backup_id: insertedBackup.id,
      },
    })

  } catch (error) {
    console.error('[Scrape API] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to scrape Twitter data',
    }, { status: 500 })
  }
}
