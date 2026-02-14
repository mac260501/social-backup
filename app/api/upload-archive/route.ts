import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import yauzl from 'yauzl'
import { promisify } from 'util'

const openZip = promisify(yauzl.open)

// Module-level admin client for helper functions
const supabase = createAdminClient()

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

      // Check if file already exists (409 error) - this is ok, we still count it
      const fileAlreadyExists = uploadError && (uploadError as any).statusCode === '409'

      if (uploadError && !fileAlreadyExists) {
        console.error(`Failed to upload ${fileName}:`, uploadError)
        continue // Skip this file and continue only if it's a real error
      }

      if (fileAlreadyExists) {
        console.log(`File ${fileName} already exists in storage, skipping upload but counting it`)
      } else {
        console.log(`Successfully uploaded ${fileName}`)
      }

      // Create media file record for this backup
      const metadataRecord = {
        user_id: userId,
        backup_id: backupId,
        file_path: storagePath,
        file_name: fileName,
        file_size: fileBuffer.length,
        mime_type: mimeType,
        media_type: mediaType,
      }

      // Check if a record already exists for THIS specific backup + file path combination
      // (this handles retries or re-processing of the same upload)
      const { data: existingForBackup } = await supabase
        .from('media_files')
        .select('id')
        .eq('backup_id', backupId)
        .eq('file_path', storagePath)
        .maybeSingle()

      if (existingForBackup) {
        console.log(`Media record for ${fileName} already exists for this backup, skipping insert`)
        mediaFiles.push(metadataRecord)
      } else {
        // Insert the record - with the updated schema (composite unique on backup_id + file_path),
        // the same file can be associated with multiple different backups
        const { error: insertError } = await supabase
          .from('media_files')
          .insert(metadataRecord)

        if (insertError) {
          console.error(`Failed to insert media record for ${fileName}:`, insertError)
          // Don't count files that failed to insert
        } else {
          console.log(`Inserted media record for ${fileName}`)
          mediaFiles.push(metadataRecord)
        }
      }

      uploadedCount++

      // Log progress every 10 files
      if (uploadedCount % 10 === 0) {
        console.log(`Processed ${uploadedCount}/${mediaEntries.length} media files...`)
      }

    } catch (error) {
      console.error(`Error processing media file ${entry.fileName}:`, error)
      // Continue with next file
    }
  }

  return { mediaFiles, uploadedCount }
}

/**
 * Update media URLs in tweets and DMs to point to Supabase Storage
 */
function updateMediaUrls(
  tweets: any[],
  directMessages: any[],
  mediaFiles: any[],
  userId: string
): { tweets: any[], directMessages: any[] } {
  // Create filename -> storage path mapping
  const fileMap = new Map<string, string>()
  mediaFiles.forEach(media => {
    fileMap.set(media.file_name, media.file_path)
  })

  // Get Supabase public URL for a storage path
  const getPublicUrl = (storagePath: string): string => {
    const { data } = supabase.storage
      .from('twitter-media')
      .getPublicUrl(storagePath)
    return data.publicUrl
  }

  // Extract filename from Twitter CDN URL or media object
  const extractFilename = (url: string): string | null => {
    if (!url) return null
    // Handle URLs like: https://pbs.twimg.com/media/ABC123.jpg
    // Extract: ABC123.jpg
    const match = url.match(/\/([^\/]+\.(jpg|jpeg|png|gif|mp4|webp))$/i)
    return match ? match[1] : null
  }

  // Update tweets
  const updatedTweets = tweets.map(tweet => {
    // Handle extended_entities.media
    if (tweet.extended_entities?.media) {
      tweet.extended_entities.media = tweet.extended_entities.media.map((media: any) => {
        const filename = extractFilename(media.media_url || media.media_url_https)
        if (filename && fileMap.has(filename)) {
          const storagePath = fileMap.get(filename)!
          const publicUrl = getPublicUrl(storagePath)
          return {
            ...media,
            media_url: publicUrl,
            media_url_https: publicUrl,
          }
        }
        return media
      })
    }

    // Handle entities.media
    if (tweet.entities?.media) {
      tweet.entities.media = tweet.entities.media.map((media: any) => {
        const filename = extractFilename(media.media_url || media.media_url_https)
        if (filename && fileMap.has(filename)) {
          const storagePath = fileMap.get(filename)!
          const publicUrl = getPublicUrl(storagePath)
          return {
            ...media,
            media_url: publicUrl,
            media_url_https: publicUrl,
          }
        }
        return media
      })
    }

    // Update direct media array if present
    if (tweet.media) {
      tweet.media = tweet.media.map((media: any) => {
        const filename = extractFilename(media.media_url || media.url)
        if (filename && fileMap.has(filename)) {
          const storagePath = fileMap.get(filename)!
          const publicUrl = getPublicUrl(storagePath)
          return {
            ...media,
            media_url: publicUrl,
            url: publicUrl,
          }
        }
        return media
      })
    }

    return tweet
  })

  // Update DMs
  const updatedDMs = directMessages.map(dm => {
    if (dm.messages) {
      dm.messages = dm.messages.map((msg: any) => {
        if (msg.media && Array.isArray(msg.media)) {
          msg.media = msg.media.map((media: any) => {
            const filename = extractFilename(media.url)
            if (filename && fileMap.has(filename)) {
              const storagePath = fileMap.get(filename)!
              const publicUrl = getPublicUrl(storagePath)
              return {
                ...media,
                url: publicUrl,
              }
            }
            return media
          })
        }
        return msg
      })
    }
    return dm
  })

  return { tweets: updatedTweets, directMessages: updatedDMs }
}

export async function POST(request: Request) {
  let tmpPath = ''
  const fs = require('fs')

  try {
    // Authenticate via Supabase
    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const formData = await request.formData()
    const file = formData.get('file') as File
    const username = formData.get('username') as string

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
    }

    console.log('Processing archive for:', username)

    const userUuid = user.id
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
      for (const fileName of ['data/account.js', 'data/tweets.js', 'data/tweet.js', 'data/follower.js', 'data/following.js', 'data/like.js', 'data/direct-messages.js']) {
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

    // Helper: extract @username from a Twitter profile URL
    // e.g. "https://twitter.com/someuser" -> "someuser"
    const extractUsernameFromUrl = (url: string): string | undefined => {
      if (!url) return undefined
      const m = url.match(/^https?:\/\/(twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/?$/)
      return m ? m[2] : undefined
    }

    // Parse account.js for owner profile info (avatar, cover, display name)
    let accountProfile: { username?: string; displayName?: string; avatarMediaUrl?: string; headerMediaUrl?: string } = {}
    if (files['data/account.js']) {
      const accountData = parseTwitterJSON(files['data/account.js'])
      const account = accountData[0]?.account
      if (account) {
        accountProfile = {
          username: account.username,
          displayName: account.accountDisplayName,
          avatarMediaUrl: account.avatarMediaUrl,
          headerMediaUrl: account.headerMediaUrl,
        }
        console.log('Account profile:', accountProfile)
      }
    }

    // Process extracted files
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
        // Preserve media references for display in viewer
        extended_entities: item.tweet?.extended_entities,
        entities: item.tweet?.entities,
        media: item.tweet?.extended_entities?.media || item.tweet?.entities?.media,
        // Inject owner profile info so tweets display the correct username/avatar
        author: {
          username: accountProfile.username || username,
          name: accountProfile.displayName || username,
          profileImageUrl: accountProfile.avatarMediaUrl,
        },
      })).filter((t: any) => t.id)
      stats.tweets = tweets.length
    }

    let followers = []
    if (files['data/follower.js']) {
      const followersData = parseTwitterJSON(files['data/follower.js'])
      followers = followersData.map((item: any) => {
        const accountId = item.follower?.accountId
        const rawLink = item.follower?.userLink || ''
        const extractedUsername = extractUsernameFromUrl(rawLink)

        return {
          user_id: accountId,
          username: extractedUsername,
          name: extractedUsername,  // Use username as display name since full name not available
          userLink: rawLink || `https://twitter.com/intent/user?user_id=${accountId}`
        }
      }).filter((f: any) => f.user_id)
      stats.followers = followers.length
    }

    let following = []
    if (files['data/following.js']) {
      const followingData = parseTwitterJSON(files['data/following.js'])
      following = followingData.map((item: any) => {
        const accountId = item.following?.accountId
        const rawLink = item.following?.userLink || ''
        const extractedUsername = extractUsernameFromUrl(rawLink)

        return {
          user_id: accountId,
          username: extractedUsername,
          name: extractedUsername,  // Use username as display name since full name not available
          userLink: rawLink || `https://twitter.com/intent/user?user_id=${accountId}`
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
            // Preserve media references for DMs
            media: msg.messageCreate?.mediaUrls || msg.messageCreate?.media || [],
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

    console.log(`Processed ${uploadedCount} media files (${mediaFiles.length} new records inserted)`)

    // Update media URLs to point to Supabase Storage
    console.log('Updating media URLs in backup data...')
    const { tweets: updatedTweets, directMessages: updatedDMs } = updateMediaUrls(
      tweets,
      directMessages,
      mediaFiles,
      userUuid
    )

    // Resolve profile/cover image URLs from uploaded profile_media files
    const profileMediaFiles = mediaFiles.filter(f => f.media_type === 'profile_media')
    const getPublicMediaUrl = (storagePath: string): string => {
      const { data } = supabase.storage.from('twitter-media').getPublicUrl(storagePath)
      return data.publicUrl
    }

    // Match avatarMediaUrl / headerMediaUrl filenames against uploaded profile_media
    const resolveProfileMediaUrl = (cdnUrl: string | undefined): string | undefined => {
      if (!cdnUrl) return undefined
      const cdnFilename = cdnUrl.split('/').pop()?.split('?')[0]
      if (!cdnFilename) return undefined
      // Try exact match first, then partial match
      const matched = profileMediaFiles.find(f =>
        f.file_name === cdnFilename || f.file_name.includes(cdnFilename.replace(/\.[^.]+$/, ''))
      )
      return matched ? getPublicMediaUrl(matched.file_path) : undefined
    }

    // Build profile object for this archive backup
    const resolvedProfileImageUrl = resolveProfileMediaUrl(accountProfile.avatarMediaUrl)
    const resolvedCoverImageUrl = resolveProfileMediaUrl(accountProfile.headerMediaUrl)

    // Fallback: if we have exactly 1 or 2 profile media files, assign by file name heuristic
    let profileImageUrl = resolvedProfileImageUrl
    let coverImageUrl = resolvedCoverImageUrl
    if (!profileImageUrl && profileMediaFiles.length > 0) {
      const avatarFile = profileMediaFiles.find(f =>
        f.file_name.includes('profile_image') || f.file_name.includes('avatar') || f.file_name.includes('400x400')
      ) || profileMediaFiles[0]
      profileImageUrl = getPublicMediaUrl(avatarFile.file_path)
    }
    if (!coverImageUrl && profileMediaFiles.length > 1) {
      const headerFile = profileMediaFiles.find(f =>
        f.file_name.includes('header') || f.file_name.includes('banner') || f.file_name.includes('cover')
      ) || profileMediaFiles.find(f => getPublicMediaUrl(f.file_path) !== profileImageUrl)
      if (headerFile) coverImageUrl = getPublicMediaUrl(headerFile.file_path)
    }

    const archiveProfile = {
      username: accountProfile.username || username,
      displayName: accountProfile.displayName || username,
      profileImageUrl: profileImageUrl || accountProfile.avatarMediaUrl,
      coverImageUrl: coverImageUrl || accountProfile.headerMediaUrl,
    }

    // Update stats to include media count
    const updatedStats = {
      ...stats,
      media_files: uploadedCount,
    }

    // Upload the original ZIP file to storage for future downloads
    console.log('Uploading original archive ZIP to storage...')
    const archiveStoragePath = `${userUuid}/archives/${backupId}.zip`
    const { error: archiveUploadError } = await supabase.storage
      .from('twitter-media')
      .upload(archiveStoragePath, buffer, {
        contentType: 'application/zip',
        upsert: false,
      })

    if (archiveUploadError && archiveUploadError.message !== 'The resource already exists') {
      console.error('Failed to upload archive ZIP:', archiveUploadError)
      // Don't fail the whole upload, just log the error
    } else {
      console.log('Successfully uploaded archive ZIP')
    }

    // Update the backup record with the new stats, updated media URLs, and archive path
    const { error: updateError } = await supabase
      .from('backups')
      .update({
        stats: updatedStats,
        data: {
          tweets: updatedTweets,
          followers,
          following,
          likes,
          direct_messages: updatedDMs,
          profile: archiveProfile,
        },
        archive_file_path: archiveUploadError ? null : archiveStoragePath
      })
      .eq('id', backupId)

    if (updateError) {
      console.error('Failed to update backup:', updateError)
      // Don't fail the whole upload, just log the error
    } else {
      console.log('Successfully updated backup with media URLs and archive path')
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