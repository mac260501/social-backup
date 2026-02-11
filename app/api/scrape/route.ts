import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { getTwitterProvider } from '@/lib/twitter/twitter-service'
import type { Tweet } from '@/lib/twitter/types'

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

/**
 * Download and store media files from scraped tweets
 * Runs in background after scrape completes
 */
async function processScrapedMedia(userId: string, backupId: string, tweetsWithMedia: Tweet[]) {
  let processedCount = 0
  let errorCount = 0

  for (const tweet of tweetsWithMedia) {
    if (!tweet.media || tweet.media.length === 0) continue

    for (const media of tweet.media) {
      try {
        if (!media.media_url) {
          console.warn(`[Scraped Media] No media_url for tweet ${tweet.id}, skipping`)
          continue
        }

        // Download the media file
        const response = await fetch(media.media_url)
        if (!response.ok) {
          console.error(`[Scraped Media] Failed to download ${media.media_url}: ${response.statusText}`)
          errorCount++
          continue
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Generate filename from URL
        const urlParts = media.media_url.split('/')
        const filename = urlParts[urlParts.length - 1] || `${tweet.id}-${media.type}`

        // Determine MIME type
        const mimeType = media.type === 'photo' ? 'image/jpeg'
          : media.type === 'video' ? 'video/mp4'
          : 'image/gif'

        // Upload to storage
        const storagePath = `${userId}/scraped_media/${filename}`
        const { error: uploadError } = await supabase.storage
          .from('twitter-media')
          .upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: true  // Overwrite if exists
          })

        if (uploadError && uploadError.message !== 'The resource already exists') {
          console.error(`[Scraped Media] Upload error for ${filename}:`, uploadError)
          errorCount++
          continue
        }

        // Create database record
        const metadataRecord = {
          user_id: userId,
          backup_id: backupId,
          file_path: storagePath,
          file_name: filename,
          file_size: buffer.length,
          mime_type: mimeType,
          media_type: 'scraped_media',
          tweet_id: tweet.id,
        }

        // Check if record already exists for this backup + file path
        const { data: existing } = await supabase
          .from('media_files')
          .select('id')
          .eq('backup_id', backupId)
          .eq('file_path', storagePath)
          .maybeSingle()

        if (!existing) {
          const { error: insertError } = await supabase
            .from('media_files')
            .insert(metadataRecord)

          if (insertError) {
            console.error(`[Scraped Media] DB insert error for ${filename}:`, insertError)
            errorCount++
            continue
          }
        }

        processedCount++
        console.log(`[Scraped Media] Processed ${processedCount}/${tweetsWithMedia.length} - ${filename}`)

      } catch (error) {
        console.error('[Scraped Media] Error processing media:', error)
        errorCount++
      }
    }
  }

  console.log(`[Scraped Media] Complete: ${processedCount} processed, ${errorCount} errors`)
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

    // Count media files from tweets
    const tweetsWithMedia = result.tweets.filter(t => t.media && t.media.length > 0)
    const totalMediaCount = tweetsWithMedia.reduce((sum, t) => sum + (t.media?.length || 0), 0)

    console.log(`[Scrape API] Scrape completed:`, {
      tweets: result.tweets.length,
      tweetsWithMedia: tweetsWithMedia.length,
      totalMedia: totalMediaCount,
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
        profile: {
          username: result.metadata.username,
          displayName: result.metadata.displayName,
          profileImageUrl: result.metadata.profileImageUrl,
          coverImageUrl: result.metadata.coverImageUrl,
        },
      },
      stats: {
        tweets: result.tweets.length,
        followers: result.followers.length,
        following: result.following.length,
        likes: 0,
        dms: 0,
        media_files: totalMediaCount,  // Count of media URLs found in tweets
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

    // Download and store media files from scraped tweets (in background)
    if (totalMediaCount > 0) {
      console.log(`[Scrape API] Processing ${totalMediaCount} media files from scraped tweets...`)

      // Process media in the background - don't await to speed up response
      processScrapedMedia(userUuid, insertedBackup.id, tweetsWithMedia).catch(err => {
        console.error('[Scrape API] Error processing scraped media:', err)
      })
    }

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
        media_files: totalMediaCount,
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
