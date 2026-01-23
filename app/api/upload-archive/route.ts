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

// Helper to extract media files from ZIP
async function extractMediaFiles(
  zipPath: string,
  userId: string,
  backupId: string
): Promise<{ mediaFiles: any[], uploadedCount: number }> {
  const fs = require('fs')
  const mediaFolders = [
    'data/tweets_media',
    'data/direct_messages_media',
    'data/direct_messages_group_media',
    'data/grok_chat_media',
    'data/community_tweet_media',
    'data/profile_media',
    'data/moments_media',
    'data/moments_tweets_media',
    'data/deleted_tweets_media',
  ]

  const mediaFiles: any[] = []
  let uploadedCount = 0

  // Open ZIP to get all entries
  const zipfile: any = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) reject(err)
      else resolve(zipfile)
    })
  })

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

  // Filter media entries
  const mediaEntries = entries.filter((entry: any) => {
    return mediaFolders.some(folder => entry.fileName.startsWith(folder + '/'))
      && !entry.fileName.endsWith('/') // Skip directories
  })

  console.log(`Found ${mediaEntries.length} media files to upload`)

  // Upload each media file
  for (const entry of mediaEntries) {
    try {
      // Extract file content
      const zipfile2: any = await new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => err ? reject(err) : resolve(zf))
      })

      const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
        zipfile2.on('entry', (e: any) => {
          if (e.fileName === entry.fileName) {
            zipfile2.openReadStream(e, (err: any, stream: any) => {
              if (err) {
                reject(err)
                return
              }
              const chunks: Buffer[] = []
              stream.on('data', (chunk: Buffer) => chunks.push(chunk))
              stream.on('end', () => resolve(Buffer.concat(chunks)))
              stream.on('error', reject)
            })
          } else {
            zipfile2.readEntry()
          }
        })
        zipfile2.readEntry()
      })

      zipfile2.close()

      // Determine media type (folder name)
      const mediaType = entry.fileName.split('/')[1] // e.g., 'tweets_media'
      const fileName = entry.fileName.split('/').pop() // e.g., 'image.jpg'
      
      // Storage path: {userId}/{mediaType}/{fileName}
      const storagePath = `${userId}/${mediaType}/${fileName}`

      // Determine MIME type from file extension
      const ext = fileName.split('.').pop()?.toLowerCase()
      const mimeTypes: { [key: string]: string } = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'mp4': 'video/mp4',
        'mov': 'video/quicktime',
        'webp': 'image/webp',
      }
      const mimeType = mimeTypes[ext || ''] || 'application/octet-stream'

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('twitter-media')
        .upload(storagePath, fileBuffer, {
          contentType: mimeType,
          upsert: false, // Don't overwrite existing files
        })

      if (uploadError) {
        console.error(`Failed to upload ${fileName}:`, uploadError)
        continue // Skip this file and continue
      }

      // Save metadata to database
      mediaFiles.push({
        user_id: userId,
        backup_id: backupId,
        file_path: storagePath,
        file_name: fileName,
        file_size: fileBuffer.length,
        mime_type: mimeType,
        media_type: mediaType,
      })

      uploadedCount++
      
      // Log progress every 10 files
      if (uploadedCount % 10 === 0) {
        console.log(`Uploaded ${uploadedCount}/${mediaEntries.length} media files...`)
      }

    } catch (error) {
      console.error(`Error processing media file ${entry.fileName}:`, error)
      // Continue with next file
    }
  }

  return { mediaFiles, uploadedCount }
}

export async function POST(request: Request) {
  let tmpPath = ''
  const fs = require('fs')

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
    tmpPath = `/tmp/archive-${Date.now()}.zip`
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

    // Insert backup and get the ID
    const { data: backupData, error: backupError } = await supabase
      .from('backups')
      .insert({
        user_id: userUuid,
        data: { tweets, followers, following, likes, direct_messages: directMessages },
        stats,
        file_size: buffer.length,
        archive_date: new Date().toISOString(),
    })
    .select()
    .single()

    if (backupError) {
      throw new Error(`Failed to create backup: ${backupError.message}`)
    }

    const backupId = backupData.id

    console.log('Backup created, now processing media files...')

    // Extract and upload media files
    const { mediaFiles, uploadedCount } = await extractMediaFiles(tmpPath, userUuid, backupId)

    console.log(`Uploaded ${uploadedCount} media files`)

    // Save media file records to database
    if (mediaFiles.length > 0) {
      const { error: mediaError } = await supabase
        .from('media_files')
        .insert(mediaFiles)

      if (mediaError) {
        console.error('Failed to save media file records:', mediaError)
        // Don't fail the whole upload, just log the error
      }
    }

    // Update stats to include media count
    const updatedStats = {
      ...stats,
      media_files: uploadedCount,
    }

    // Update the backup record with the new stats including media count
    const { error: updateError } = await supabase
      .from('backups')
      .update({ stats: updatedStats })
      .eq('id', backupId)

    if (updateError) {
      console.error('Failed to update backup stats:', updateError)
      // Don't fail the whole upload, just log the error
    }

    // Clean up temp file
    fs.unlinkSync(tmpPath)

    return NextResponse.json({
      success: true,
      message: 'Archive processed!',
      stats: updatedStats
    })
  } catch (error) {
    console.error('Error:', error)
    
    // Clean up temp file on error
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath)
    }
    
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}