import { NextResponse } from 'next/server'
import { TwitterApi } from 'twitter-api-v2'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
    const { username, userId } = await request.json()

    console.log('Starting backup for:', username)

    const userUuid = createUuidFromString(userId)

    // Check if profile exists, if not create it
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userUuid)
      .single()

    if (!existingProfile) {
      await supabase
        .from('profiles')
        .insert({
          id: userUuid,
          twitter_username: username,
          twitter_user_id: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
    }

    // Use Twitter API with Bearer Token
    const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!)

    try {
      // Get user info
      const user = await client.v2.userByUsername(username)
      
      if (!user.data) {
        throw new Error('User not found')
      }

      // Get user's tweets
      const tweets = await client.v2.userTimeline(user.data.id, {
        max_results: 10, // Reduced to save rate limits
      })

      const tweetsData = tweets.data.data?.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at,
      })) || []

      console.log('Fetched tweets:', tweetsData.length)

      // Save to Supabase
      if (tweetsData.length > 0) {
        const { error } = await supabase
          .from('backups')
          .insert({
            user_id: userUuid,
            backup_type: 'tweets',
            data: { tweets: tweetsData, scraped_at: new Date().toISOString() },
          })

        if (error) {
          console.error('Supabase error:', error)
          throw error
        }
      }

      return NextResponse.json({ 
        success: true, 
        message: `Backed up ${tweetsData.length} tweets`,
        tweets: tweetsData 
      })

    } catch (apiError: any) {
      if (apiError.code === 429) {
        return NextResponse.json({ 
          success: false, 
          error: 'Rate limit exceeded. Twitter API has usage limits. Please try again in 15 minutes.',
          isRateLimit: true
        }, { status: 429 })
      }
      throw apiError
    }

  } catch (error) {
    console.error('Backup error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to backup tweets' 
    }, { status: 500 })
  }
}