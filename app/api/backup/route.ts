import { NextResponse } from 'next/server'
import { TwitterApi } from 'twitter-api-v2'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { username } = await request.json()
    if (!username) {
      return NextResponse.json({ success: false, error: 'Username is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!)

    try {
      const twitterUser = await client.v2.userByUsername(username)
      if (!twitterUser.data) {
        throw new Error('User not found')
      }

      const tweets = await client.v2.userTimeline(twitterUser.data.id, {
        max_results: 10,
      })

      const tweetsData =
        tweets.data.data?.map((tweet) => ({
          id: tweet.id,
          text: tweet.text,
          created_at: tweet.created_at,
        })) || []

      if (tweetsData.length > 0) {
        const { error: insertError } = await adminClient.from('backups').insert({
          user_id: user.id,
          backup_type: 'tweets',
          source: 'api',
          data: { tweets: tweetsData, scraped_at: new Date().toISOString() },
        })

        if (insertError) {
          throw new Error(insertError.message)
        }
      }

      return NextResponse.json({
        success: true,
        message: `Backed up ${tweetsData.length} tweets`,
        tweets: tweetsData,
      })
    } catch (apiError: unknown) {
      if (
        typeof apiError === 'object' &&
        apiError !== null &&
        'code' in apiError &&
        (apiError as { code?: number }).code === 429
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Rate limit exceeded. Twitter API has usage limits. Please try again in 15 minutes.',
            isRateLimit: true,
          },
          { status: 429 }
        )
      }
      throw apiError
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to backup tweets',
      },
      { status: 500 }
    )
  }
}
