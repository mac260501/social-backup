import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import yauzl from 'yauzl'
import { promisify } from 'util'

const openZip = promisify(yauzl.open)

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

// Helper to extract file from yauzl
function extractFileFromZip(zipfile: any, fileName: string): Promise<string | null> {
  return new Promise((resolve) => {
    zipfile.on('entry', (entry: any) => {
      if (entry.fileName === fileName) {
        zipfile.openReadStream(entry, (err: any, readStream: any) => {
          if (err) {
            console.error(`Error reading ${fileName}:`, err)
            resolve(null)
            return
          }
          
          const chunks: Buffer[] = []
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
          readStream.on('end', () => {
            const content = Buffer.concat(chunks).toString('utf8')
            resolve(content)
          })
          readStream.on('error', () => resolve(null))
        })
      }
    })
    
    zipfile.on('end', () => resolve(null))
  })
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
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Write buffer to temp file for yauzl
    const tmpPath = `/tmp/archive-${Date.now()}.zip`
    const fs = require('fs')
    fs.writeFileSync(tmpPath, buffer)

    // Extract files
    const files: { [key: string]: string } = {}
    
    try {
      const zipfile: any = await new Promise((resolve, reject) => {
        yauzl.open(tmpPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
          if (err) reject(err)
          else resolve(zipfile)
        })
      })

      // Get all entries first
      const entries: any[] = []
      await new Promise<void>((resolve) => {
        zipfile.on('entry', (entry: any) => {
          entries.push(entry)
          zipfile.readEntry()
        })
        zipfile.on('end', () => resolve())
        zipfile.readEntry()
      })

      zipfile.close()

      // Now extract the files we need
      for (const fileName of ['data/tweets.js', 'data/tweet.js', 'data/follower.js', 'data/following.js', 'data/like.js', 'data/direct-messages.js']) {
        const entry = entries.find(e => e.fileName === fileName)
        if (entry) {
          const zipfile2: any = await new Promise((resolve, reject) => {
            yauzl.open(tmpPath, { lazyEntries: true }, (err, zf) => err ? reject(err) : resolve(zf))
          })

          const content = await new Promise<string>((resolve) => {
            zipfile2.on('entry', (e: any) => {
              if (e.fileName === fileName) {
                zipfile2.openReadStream(e, (err: any, stream: any) => {
                  if (err) {
                    resolve('')
                    return
                  }
                  const chunks: Buffer[] = []
                  stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                  stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
                })
              } else {
                zipfile2.readEntry()
              }
            })
            zipfile2.readEntry()
          })

          zipfile2.close()
          if (content) {
            files[fileName] = content
            console.log(`Extracted ${fileName}`)
          }
        }
      }

      // Clean up temp file
      fs.unlinkSync(tmpPath)
    } catch (error) {
      console.error('Error extracting ZIP:', error)
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      throw new Error('Failed to extract archive')
    }

    const stats = { tweets: 0, followers: 0, following: 0, likes: 0, dms: 0 }

    // Process extracted files (same as before)
    let tweets = []
    const tweetsContent = files['data/tweets.js'] || files['data/tweet.js']
    if (tweetsContent) {
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

    let followers = []
    if (files['data/follower.js']) {
      const followersData = parseTwitterJSON(files['data/follower.js'])
      followers = followersData.map((item: any) => {
        const accountId = item.follower?.accountId
        const userLink = item.follower?.userLink || ''

        return {
          user_id: accountId,
          username: undefined,  // Not available in Twitter archives
          name: undefined,      // Not available in Twitter archives
          userLink: userLink || `https://twitter.com/intent/user?user_id=${accountId}`
        }
      }).filter((f: any) => f.user_id)
      stats.followers = followers.length
    }

    let following = []
    if (files['data/following.js']) {
      const followingData = parseTwitterJSON(files['data/following.js'])
      following = followingData.map((item: any) => {
        const accountId = item.following?.accountId
        const userLink = item.following?.userLink || ''

        return {
          user_id: accountId,
          username: undefined,  // Not available in Twitter archives
          name: undefined,      // Not available in Twitter archives
          userLink: userLink || `https://twitter.com/intent/user?user_id=${accountId}`
        }
      }).filter((f: any) => f.user_id)
      stats.following = following.length
    }

    let likes = []
    if (files['data/like.js']) {
      const likesData = parseTwitterJSON(files['data/like.js'])
      likes = likesData.map((item: any) => ({
        tweet_id: item.like?.tweetId,
        full_text: item.like?.fullText,
      })).filter((l: any) => l.tweet_id)
      stats.likes = likes.length
    }

    let directMessages = []
    if (files['data/direct-messages.js']) {
      const dmsData = parseTwitterJSON(files['data/direct-messages.js'])
      directMessages = dmsData.map((item: any) => {
        const messages = item.dmConversation?.messages || []
        const messageTexts = messages.map((msg: any) => {
          const senderId = msg.messageCreate?.senderId
          const recipientId = msg.messageCreate?.recipientId

          return {
            text: msg.messageCreate?.text || '',
            created_at: msg.messageCreate?.createdAt,
            sender_id: senderId,
            recipient_id: recipientId,
            senderLink: senderId ? `https://twitter.com/intent/user?user_id=${senderId}` : undefined,
            recipientLink: recipientId ? `https://twitter.com/intent/user?user_id=${recipientId}` : undefined,
          }
        })
        return {
          conversation_id: item.dmConversation?.conversationId,
          messages: messageTexts,
          message_count: messages.length,
        }
      }).filter((dm: any) => dm.conversation_id)
      stats.dms = directMessages.reduce((sum: number, dm: any) => sum + dm.message_count, 0)
    }

    console.log('Stats:', stats)

    // Save to database
    const { data: existingProfile } = await supabase.from('profiles').select('id').eq('id', userUuid).single()
    if (!existingProfile) {
      await supabase.from('profiles').insert({
        id: userUuid,
        twitter_username: username,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }

    await supabase.from('backups').insert({
      user_id: userUuid,
      data: { tweets, followers, following, likes, direct_messages: directMessages },
      stats,
      file_size: buffer.length,
      archive_date: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, message: 'Archive processed!', stats })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}