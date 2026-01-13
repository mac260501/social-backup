import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import AdmZip from 'adm-zip'

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

function parseTwitterJSON(content: string) {
  // Twitter archives have format: window.YTD.tweets.part0 = [...]
  const jsonMatch = content.match(/=\s*(\[[\s\S]*\])/)?.[1]
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch)
    } catch (e) {
      console.error('Failed to parse JSON:', e)
      return []
    }
  }
  return []
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const userId = formData.get('userId') as string
    const username = formData.get('username') as string

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
    }

    console.log('Processing archive for:', username)

    const userUuid = createUuidFromString(userId)

    // Read the ZIP file
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const zip = new AdmZip(buffer)

    const stats = {
      tweets: 0,
      followers: 0,
      following: 0,
      likes: 0,
      dms: 0,
    }

    // Extract tweets
    let tweets = []
    const tweetsEntry = zip.getEntry('data/tweets.js') || zip.getEntry('data/tweet.js')
    if (tweetsEntry) {
      const tweetsContent = tweetsEntry.getData().toString('utf8')
      const tweetsData = parseTwitterJSON(tweetsContent)
      tweets = tweetsData.map((item: any) => ({
        id: item.tweet?.id_str,
        text: item.tweet?.full_text || item.tweet?.text,
        created_at: item.tweet?.created_at,
        retweet_count: item.tweet?.retweet_count,
        favorite_count: item.tweet?.favorite_count,
      })).filter((t: any) => t.id)
      stats.tweets = tweets.length
    }

    // Extract followers
    let followers = []
    const followersEntry = zip.getEntry('data/follower.js')
    if (followersEntry) {
      const followersContent = followersEntry.getData().toString('utf8')
      const followersData = parseTwitterJSON(followersContent)
      followers = followersData.map((item: any) => ({
        username: item.follower?.userLink?.split('/').pop() || item.follower?.accountId,
      })).filter((f: any) => f.username)
      stats.followers = followers.length
    }

    // Extract following
    let following = []
    const followingEntry = zip.getEntry('data/following.js')
    if (followingEntry) {
      const followingContent = followingEntry.getData().toString('utf8')
      const followingData = parseTwitterJSON(followingContent)
      following = followingData.map((item: any) => ({
        username: item.following?.userLink?.split('/').pop() || item.following?.accountId,
      })).filter((f: any) => f.username)
      stats.following = following.length
    }

    // Extract likes
    let likes = []
    const likesEntry = zip.getEntry('data/like.js')
    if (likesEntry) {
      const likesContent = likesEntry.getData().toString('utf8')
      const likesData = parseTwitterJSON(likesContent)
      likes = likesData.map((item: any) => ({
        tweet_id: item.like?.tweetId,
        full_text: item.like?.fullText,
      })).filter((l: any) => l.tweet_id)
      stats.likes = likes.length
    }

    // Extract direct messages
    let directMessages = []
    const dmsEntry = zip.getEntry('data/direct-messages.js')
    if (dmsEntry) {
      const dmsContent = dmsEntry.getData().toString('utf8')
      const dmsData = parseTwitterJSON(dmsContent)
      directMessages = dmsData.map((item: any) => ({
        conversation_id: item.dmConversation?.conversationId,
        messages: item.dmConversation?.messages?.length || 0,
      })).filter((dm: any) => dm.conversation_id)
      stats.dms = directMessages.reduce((sum: number, dm: any) => sum + dm.messages, 0)
    }

    console.log('Extracted stats:', stats)

    // Save to Supabase - ensure profile exists first
    const { data: existingProfile, error: profileCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userUuid)
      .single()

    if (!existingProfile) {
      console.log('Creating new profile for:', username)
      const { data: newProfile, error: profileInsertError } = await supabase
        .from('profiles')
        .insert({
          id: userUuid,
          twitter_username: username,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (profileInsertError) {
        console.error('Failed to create profile:', profileInsertError)
        throw new Error(`Failed to create profile: ${profileInsertError.message}`)
      }
      console.log('Profile created successfully')
    } else {
      console.log('Profile already exists')
    }

    // Create single backup snapshot with all data
    const backupSnapshot = {
      user_id: userUuid,
      backup_name: null, // Can be set by user later
      data: {
        tweets,
        followers,
        following,
        likes,
        direct_messages: directMessages,
      },
      stats,
      file_size: buffer.length,
      archive_date: new Date().toISOString(),
    }

    console.log('Creating backup snapshot')

    const { data: insertedBackup, error: backupError } = await supabase
      .from('backups')
      .insert(backupSnapshot)
      .select()
      .single()

    if (backupError) {
      console.error('Failed to insert backup:', backupError)
      throw new Error(`Failed to insert backup: ${backupError.message}`)
    }
    console.log('Successfully created backup snapshot:', insertedBackup?.id)

    return NextResponse.json({
      success: true,
      message: 'Archive processed successfully!',
      stats,
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process archive',
    }, { status: 500 })
  }
}