import { NextResponse } from 'next/server'
import { getTwitterProvider } from '@/lib/twitter/twitter-service'
import type { Tweet, TwitterScrapeTargets } from '@/lib/twitter/types'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  parseRequestedTweetCount,
  TWITTER_SCRAPE_LIMITS,
} from '@/lib/platforms/twitter/limits'

const supabase = createAdminClient()
const TWITTER_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/
const DEFAULT_SCRAPE_TARGETS: TwitterScrapeTargets = {
  profile: true,
  tweets: true,
  replies: true,
  followers: true,
  following: true,
}

const OPTIONAL_MEDIA_FILE_COLUMNS = new Set([
  'file_name',
  'file_size',
  'mime_type',
  'media_type',
  'tweet_id',
])

function parseMissingColumnName(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error || error.code !== 'PGRST204' || typeof error.message !== 'string') return null
  const match = error.message.match(/'([^']+)' column of 'media_files'/)
  return match?.[1] || null
}

async function insertMediaFileRecord(payload: Record<string, unknown>) {
  const nextPayload = { ...payload }
  const maxRetries = OPTIONAL_MEDIA_FILE_COLUMNS.size
  let attempt = 0

  while (attempt <= maxRetries) {
    const { error } = await supabase.from('media_files').insert(nextPayload)
    if (!error) return null

    const missingColumn = parseMissingColumnName(error)
    if (!missingColumn || !OPTIONAL_MEDIA_FILE_COLUMNS.has(missingColumn)) {
      return error
    }

    if (!(missingColumn in nextPayload)) {
      return error
    }

    delete nextPayload[missingColumn]
    attempt += 1
  }

  return new Error('Failed to insert media_files record after removing optional columns.')
}

function parseScrapeTargets(value: unknown): TwitterScrapeTargets | null {
  if (value === undefined || value === null) return { ...DEFAULT_SCRAPE_TARGETS }
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const source = value as Record<string, unknown>
  const read = (key: keyof TwitterScrapeTargets) => {
    if (source[key] === undefined) return DEFAULT_SCRAPE_TARGETS[key]
    return Boolean(source[key])
  }

  return {
    profile: read('profile'),
    tweets: read('tweets'),
    replies: read('replies'),
    followers: read('followers'),
    following: read('following'),
  }
}

/**
 * Download and store profile + cover photos for a scraped backup.
 * Runs after backup row is inserted so we can update data.profile with storage paths.
 */
async function processScrapedProfileMedia(
  userId: string,
  backupId: string,
  profileImageUrl: string | undefined,
  coverImageUrl: string | undefined,
) {
  if (!profileImageUrl && !coverImageUrl) return

  console.log(`[Profile Media] Processing profile photos for backup ${backupId}`)

  const uploadImage = async (sourceUrl: string, filename: string): Promise<string | null> => {
    try {
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        console.error(`[Profile Media] Failed to download ${sourceUrl}: ${response.statusText}`)
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const contentType = response.headers.get('content-type') || 'image/jpeg'

      const storagePath = `${userId}/profile_media/${filename}`

      const { error: uploadError } = await supabase.storage
        .from('twitter-media')
        .upload(storagePath, buffer, { contentType, upsert: true })

      if (uploadError && uploadError.message !== 'The resource already exists') {
        console.error(`[Profile Media] Upload error for ${filename}:`, uploadError)
        return null
      }

      // Upsert media_files record
      const { data: existing } = await supabase
        .from('media_files')
        .select('id')
        .eq('backup_id', backupId)
        .eq('file_path', storagePath)
        .maybeSingle()

      if (!existing) {
        const insertError = await insertMediaFileRecord({
          user_id: userId,
          backup_id: backupId,
          file_path: storagePath,
          file_name: filename,
          file_size: buffer.length,
          mime_type: contentType,
          media_type: 'profile_media',
        })
        if (insertError) {
          console.error(`[Profile Media] DB insert error for ${filename}:`, insertError)
        }
      }

      console.log(`[Profile Media] Uploaded ${filename}`)
      return storagePath
    } catch (err) {
      console.error(`[Profile Media] Error processing ${filename}:`, err)
      return null
    }
  }

  const [profileStoragePath, coverStoragePath] = await Promise.all([
    profileImageUrl ? uploadImage(profileImageUrl, 'profile_photo_400x400.jpg') : Promise.resolve(null),
    coverImageUrl   ? uploadImage(coverImageUrl,   'cover_photo.jpg')           : Promise.resolve(null),
  ])

  // Update backup.data.profile with the storage paths so profile-media API can serve signed URLs
  const uploadedProfileCount = [profileStoragePath, coverStoragePath].filter(Boolean).length
  if (profileStoragePath || coverStoragePath) {
    const { data: backup } = await supabase
      .from('backups')
      .select('data')
      .eq('id', backupId)
      .single()

    if (backup) {
      const updatedProfile = {
        ...(backup.data?.profile || {}),
        ...(profileStoragePath ? { profileImageUrl: profileStoragePath } : {}),
        ...(coverStoragePath   ? { coverImageUrl:   coverStoragePath   } : {}),
      }

      // Recalculate media_files: tweet media (stats minus pre-counted profile photos) + actual uploaded profile photos
      const currentStats = backup.data?.stats || {}
      const previousTotal = currentStats.media_files || 0
      const expectedProfileCount = (profileImageUrl ? 1 : 0) + (coverImageUrl ? 1 : 0)
      const tweetOnlyCount = previousTotal - expectedProfileCount
      const updatedMediaFiles = tweetOnlyCount + uploadedProfileCount

      await supabase
        .from('backups')
        .update({
          data: {
            ...backup.data,
            profile: updatedProfile,
            stats: { ...currentStats, media_files: updatedMediaFiles },
          },
        })
        .eq('id', backupId)

      console.log(`[Profile Media] Updated backup profile paths: profile=${profileStoragePath}, cover=${coverStoragePath}, media_files=${updatedMediaFiles}`)
    }
  }
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
          const insertError = await insertMediaFileRecord(metadataRecord)

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
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { username, maxTweets, targets } = body

    if (!username) {
      return NextResponse.json({ success: false, error: 'Username is required' }, { status: 400 })
    }
    if (typeof username !== 'string' || !TWITTER_USERNAME_PATTERN.test(username)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid username format. Use 1-15 letters, numbers, or underscores.',
      }, { status: 400 })
    }

    const parsedTargets = parseScrapeTargets(targets)
    if (!parsedTargets) {
      return NextResponse.json({
        success: false,
        error: 'Invalid scrape targets. Use booleans for profile, tweets, replies, followers, and following.',
      }, { status: 400 })
    }

    if (!Object.values(parsedTargets).some(Boolean)) {
      return NextResponse.json({
        success: false,
        error: 'Select at least one type of data to scrape.',
      }, { status: 400 })
    }

    const userUuid = user.id
    const needsTimelineScrape = parsedTargets.tweets || parsedTargets.replies
    let tweetsToScrape = TWITTER_SCRAPE_LIMITS.defaultTweets

    if (needsTimelineScrape) {
      const parsedTweetLimit = parseRequestedTweetCount(maxTweets)
      if (parsedTweetLimit === null) {
        return NextResponse.json({
          success: false,
          error: 'Invalid maxTweets value. It must be an integer.',
        }, { status: 400 })
      }
      if (parsedTweetLimit < TWITTER_SCRAPE_LIMITS.minTweets) {
        return NextResponse.json({
          success: false,
          error: `maxTweets must be at least ${TWITTER_SCRAPE_LIMITS.minTweets}.`,
        }, { status: 400 })
      }
      if (parsedTweetLimit > TWITTER_SCRAPE_LIMITS.maxTweets) {
        return NextResponse.json({
          success: false,
          error: `maxTweets exceeds limit (${TWITTER_SCRAPE_LIMITS.maxTweets}).`,
        }, { status: 400 })
      }
      tweetsToScrape = parsedTweetLimit
    } else if (parsedTargets.profile) {
      // Profile-only scrape should stay minimal and cheap.
      tweetsToScrape = 1
    }

    console.log(`[Scrape API] Starting scrape for @${username}`, {
      maxTweets: tweetsToScrape,
      targets: parsedTargets,
    })

    // Get the configured Twitter provider (Apify by default)
    const twitter = getTwitterProvider()

    // Check if provider is configured
    if (!twitter.isConfigured()) {
      return NextResponse.json({
        success: false,
        error: `${twitter.getProviderName()} is not configured. Please set up API keys.`,
      }, { status: 500 })
    }

    // Scrape selected data
    const result = await twitter.scrapeAll(username, tweetsToScrape, { targets: parsedTargets })

    const timelineItems = [...result.tweets, ...result.replies]
    const timelineItemsWithMedia = timelineItems.filter((t) => t.media && t.media.length > 0)
    const tweetMediaCount = timelineItemsWithMedia.reduce((sum, t) => sum + (t.media?.length || 0), 0)
    const scrapedFollowersCount = result.followers.length
    const scrapedFollowingCount = result.following.length
    const profileFollowersCount = result.metadata.profileFollowersCount || 0
    const profileFollowingCount = result.metadata.profileFollowingCount || 0
    const followersDisplayCount = Math.max(scrapedFollowersCount, profileFollowersCount)
    const followingDisplayCount = Math.max(scrapedFollowingCount, profileFollowingCount)
    const profileMediaCount = parsedTargets.profile
      ? (result.metadata.profileImageUrl ? 1 : 0) + (result.metadata.coverImageUrl ? 1 : 0)
      : 0
    const totalMediaCount = tweetMediaCount + profileMediaCount

    console.log(`[Scrape API] Scrape completed:`, {
      tweets: result.tweets.length,
      replies: result.replies.length,
      timelineItemsWithMedia: timelineItemsWithMedia.length,
      totalMedia: totalMediaCount,
      tweetMedia: tweetMediaCount,
      profileMedia: profileMediaCount,
      followers: scrapedFollowersCount,
      following: scrapedFollowingCount,
      followersDisplayCount,
      followingDisplayCount,
      cost: result.cost.total_cost,
      targets: parsedTargets,
    })

    // Save to Supabase
    const backupSnapshot = {
      user_id: userUuid,
      backup_type: 'snapshot',
      source: 'scrape',
      data: {
        tweets: result.tweets,
        replies: result.replies,
        followers: result.followers,
        following: result.following,
        likes: [], // Scraping doesn't get likes
        direct_messages: [], // Scraping doesn't get DMs
        profile: {
          username: result.metadata.username,
          displayName: result.metadata.displayName,
          profileImageUrl: result.metadata.profileImageUrl,
          coverImageUrl: result.metadata.coverImageUrl,
          followersCount: result.metadata.profileFollowersCount,
          followingCount: result.metadata.profileFollowingCount,
        },
        stats: {
          tweets: result.tweets.length,
          replies: result.replies.length,
          followers: followersDisplayCount,
          following: followingDisplayCount,
          likes: 0,
          dms: 0,
          media_files: totalMediaCount,
        },
        scrape: {
          provider: result.cost.provider,
          total_cost: result.cost.total_cost,
          scraped_at: result.metadata.scraped_at,
          targets: parsedTargets,
        },
      },
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

    // Download and store profile + cover photos (in background)
    if (parsedTargets.profile) {
      processScrapedProfileMedia(
        userUuid,
        insertedBackup.id,
        result.metadata.profileImageUrl,
        result.metadata.coverImageUrl,
      ).catch(err => {
        console.error('[Scrape API] Error processing profile media:', err)
      })
    }

    // Download and store media files from scraped timeline (tweets + replies) in background
    if (tweetMediaCount > 0) {
      console.log(`[Scrape API] Processing ${tweetMediaCount} media files from scraped timeline...`)

      // Process media in the background - don't await to speed up response
      processScrapedMedia(userUuid, insertedBackup.id, timelineItemsWithMedia).catch(err => {
        console.error('[Scrape API] Error processing scraped media:', err)
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Scrape completed successfully!',
      data: {
        tweets: result.tweets.length,
        replies: result.replies.length,
        followers: followersDisplayCount,
        following: followingDisplayCount,
        followers_scraped: scrapedFollowersCount,
        following_scraped: scrapedFollowingCount,
        cost: result.cost.total_cost,
        provider: result.cost.provider,
        backup_id: insertedBackup.id,
        media_files: totalMediaCount,
        targets: parsedTargets,
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
