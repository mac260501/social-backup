/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import yauzl from 'yauzl'
import {
  isBackupJobCancellationRequested,
  markBackupJobCompleted,
  markBackupJobCleanup,
  markBackupJobFailed,
  markBackupJobProcessing,
  markBackupJobProgress,
  mergeBackupJobPayload,
} from '@/lib/jobs/backup-jobs'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'
import { recalculateAndPersistBackupStorage } from '@/lib/storage/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { TWITTER_UPLOAD_LIMITS } from '@/lib/platforms/twitter/limits'
import { buildInternalMediaUrl } from '@/lib/storage/media-url'
import {
  deleteObjectsFromR2,
  downloadObjectFromR2,
  uploadObjectToR2,
} from '@/lib/storage/r2'

const supabase = createAdminClient()

class JobCancelledError extends Error {
  constructor(message: string = 'Job cancelled by user') {
    super(message)
    this.name = 'JobCancelledError'
  }
}

type MediaMetadataRecord = {
  user_id: string
  backup_id: string
  file_path: string
  file_name: string
  file_size: number
  mime_type: string
  media_type: string
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

async function ensureArchiveJobNotCancelled(jobId: string) {
  const cancelRequested = await isBackupJobCancellationRequested(supabase, jobId)
  if (cancelRequested) {
    throw new JobCancelledError()
  }
}

async function listZipEntries(zipPath: string): Promise<any[]> {
  const zipfile: any = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zf) => {
      if (err) reject(err)
      else resolve(zf)
    })
  })

  return new Promise<any[]>((resolve, reject) => {
    const entries: any[] = []
    let settled = false

    const finishResolve = () => {
      if (settled) return
      settled = true
      zipfile.close()
      resolve(entries)
    }

    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      zipfile.close()
      reject(error instanceof Error ? error : new Error('Failed to read ZIP entries'))
    }

    zipfile.on('entry', (entry: any) => {
      entries.push(entry)
      if (entries.length > TWITTER_UPLOAD_LIMITS.maxZipEntries) {
        finishReject(
          new Error(
            `Archive contains too many entries (${entries.length}). Limit is ${TWITTER_UPLOAD_LIMITS.maxZipEntries}.`,
          ),
        )
        return
      }
      zipfile.readEntry()
    })

    zipfile.on('error', finishReject)
    zipfile.on('end', finishResolve)
    zipfile.readEntry()
  })
}

async function readZipEntryBufferWithLimit(
  zipPath: string,
  targetFileName: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const zipfile: any = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zf) => {
      if (err) reject(err)
      else resolve(zf)
    })
  })

  return new Promise<Buffer | null>((resolve, reject) => {
    let settled = false

    const finishResolve = (value: Buffer | null) => {
      if (settled) return
      settled = true
      zipfile.close()
      resolve(value)
    }

    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      zipfile.close()
      reject(error instanceof Error ? error : new Error('Failed to read ZIP entry'))
    }

    zipfile.on('entry', (entry: any) => {
      if (entry.fileName !== targetFileName) {
        zipfile.readEntry()
        return
      }

      zipfile.openReadStream(entry, (err: any, stream: any) => {
        if (err || !stream) {
          finishReject(err || new Error(`Could not open ZIP stream for ${targetFileName}`))
          return
        }

        const chunks: Buffer[] = []
        let totalBytes = 0

        stream.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > maxBytes) {
            stream.destroy(
              new Error(`Entry ${targetFileName} exceeds max allowed size of ${maxBytes} bytes.`),
            )
            return
          }
          chunks.push(chunk)
        })

        stream.on('end', () => finishResolve(Buffer.concat(chunks)))
        stream.on('error', finishReject)
      })
    })

    zipfile.on('error', finishReject)
    zipfile.on('end', () => finishResolve(null))
    zipfile.readEntry()
  })
}

async function extractMediaFiles(
  zipPath: string,
  userId: string,
  backupId: string,
  onProgress?: (processed: number, total: number) => Promise<void>,
  ensureActive?: () => Promise<void>,
): Promise<{ mediaFiles: MediaMetadataRecord[]; uploadedCount: number }> {
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

  const mediaFiles: MediaMetadataRecord[] = []
  let uploadedCount = 0

  const entries = await listZipEntries(zipPath)

  const mediaEntries = entries.filter((entry: any) =>
    mediaFolders.some((folder) => entry.fileName.startsWith(folder + '/')) && !entry.fileName.endsWith('/'),
  )

  if (mediaEntries.length > TWITTER_UPLOAD_LIMITS.maxMediaFiles) {
    throw new Error(`Archive contains too many media files (${mediaEntries.length}). Limit is ${TWITTER_UPLOAD_LIMITS.maxMediaFiles}.`)
  }

  const oversizedMediaEntry = mediaEntries.find(
    (entry: any) =>
      typeof entry.uncompressedSize === 'number'
      && entry.uncompressedSize > TWITTER_UPLOAD_LIMITS.maxMediaEntryBytes,
  )
  if (oversizedMediaEntry) {
    throw new Error(
      `Archive media entry ${oversizedMediaEntry.fileName} exceeds per-file limit of ${TWITTER_UPLOAD_LIMITS.maxMediaEntryBytes} bytes.`,
    )
  }

  const totalUncompressedMediaBytes = mediaEntries.reduce((sum, entry: any) => {
    const size = typeof entry.uncompressedSize === 'number' ? entry.uncompressedSize : 0
    return sum + Math.max(size, 0)
  }, 0)

  if (totalUncompressedMediaBytes > TWITTER_UPLOAD_LIMITS.maxMediaBytes) {
    throw new Error(
      `Archive media payload is too large (${totalUncompressedMediaBytes} bytes). Limit is ${TWITTER_UPLOAD_LIMITS.maxMediaBytes} bytes.`,
    )
  }

  let processedEntries = 0

  for (const entry of mediaEntries) {
    if (ensureActive) await ensureActive()
    try {
      const fileBuffer = await readZipEntryBufferWithLimit(
        zipPath,
        entry.fileName,
        TWITTER_UPLOAD_LIMITS.maxMediaEntryBytes,
      )
      if (!fileBuffer) {
        throw new Error(`Archive entry not found while reading media: ${entry.fileName}`)
      }

      const mediaType = entry.fileName.split('/')[1] || 'unknown_media'
      const fileName = (entry.fileName.split('/').pop() || entry.fileName).replace(/\\/g, '_')
      const storagePath = `${userId}/${mediaType}/${fileName}`

      const ext = fileName.split('.').pop()?.toLowerCase()
      const mimeTypes: { [key: string]: string } = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        webp: 'image/webp',
      }
      const mimeType = mimeTypes[ext || ''] || 'application/octet-stream'

      const uploadResult = await uploadObjectToR2({
        key: storagePath,
        body: fileBuffer,
        contentType: mimeType,
        upsert: false,
      })

      const metadataRecord = {
        user_id: userId,
        backup_id: backupId,
        file_path: storagePath,
        file_name: fileName,
        file_size: fileBuffer.length,
        mime_type: mimeType,
        media_type: mediaType,
      }

      const { data: existingForBackup } = await supabase
        .from('media_files')
        .select('id')
        .eq('backup_id', backupId)
        .eq('file_path', storagePath)
        .maybeSingle()

      if (existingForBackup) {
        mediaFiles.push(metadataRecord)
        uploadedCount++
      } else {
        const { error: insertError } = await supabase.from('media_files').insert(metadataRecord)

        if (!insertError) {
          mediaFiles.push(metadataRecord)
          uploadedCount++
        } else {
          console.error(`Failed to insert media record for ${fileName}:`, insertError)
        }
      }

      if (uploadResult.alreadyExists) {
        console.log(`File ${fileName} already exists in R2`) // no-op
      }

      if (uploadedCount % 10 === 0) {
        console.log(`Processed ${uploadedCount}/${mediaEntries.length} media files...`)
      }
    } catch (error) {
      console.error(`Error processing media file ${entry.fileName}:`, error)
    } finally {
      processedEntries += 1
      if (
        onProgress &&
        mediaEntries.length > 0 &&
        (processedEntries === mediaEntries.length || processedEntries % 5 === 0)
      ) {
        await onProgress(processedEntries, mediaEntries.length)
      }
    }
  }

  return { mediaFiles, uploadedCount }
}

function updateMediaUrls(
  tweets: any[],
  directMessages: any[],
  mediaFiles: MediaMetadataRecord[],
): { tweets: any[]; directMessages: any[] } {
  const fileMap = new Map<string, string>()
  mediaFiles.forEach((media) => {
    fileMap.set(media.file_name, media.file_path)
  })

  const getMediaUrl = (storagePath: string): string => buildInternalMediaUrl(storagePath)

  const extractFilename = (url: string): string | null => {
    if (!url) return null
    const match = url.match(/\/([^\/]+\.(jpg|jpeg|png|gif|mp4|webp))$/i)
    return match ? match[1] : null
  }

  const updatedTweets = tweets.map((tweet) => {
    if (tweet.extended_entities?.media) {
      tweet.extended_entities.media = tweet.extended_entities.media.map((media: any) => {
        const filename = extractFilename(media.media_url || media.media_url_https)
        if (filename && fileMap.has(filename)) {
          const storagePath = fileMap.get(filename)!
          const mediaUrl = getMediaUrl(storagePath)
          return { ...media, media_url: mediaUrl, media_url_https: mediaUrl }
        }
        return media
      })
    }

    if (tweet.entities?.media) {
      tweet.entities.media = tweet.entities.media.map((media: any) => {
        const filename = extractFilename(media.media_url || media.media_url_https)
        if (filename && fileMap.has(filename)) {
          const storagePath = fileMap.get(filename)!
          const mediaUrl = getMediaUrl(storagePath)
          return { ...media, media_url: mediaUrl, media_url_https: mediaUrl }
        }
        return media
      })
    }

    if (tweet.media) {
      tweet.media = tweet.media.map((media: any) => {
        const filename = extractFilename(media.media_url || media.url)
        if (filename && fileMap.has(filename)) {
          const storagePath = fileMap.get(filename)!
          const mediaUrl = getMediaUrl(storagePath)
          return { ...media, media_url: mediaUrl, url: mediaUrl }
        }
        return media
      })
    }

    return tweet
  })

  const updatedDMs = directMessages.map((dm) => {
    if (dm.messages) {
      dm.messages = dm.messages.map((msg: any) => {
        if (msg.media && Array.isArray(msg.media)) {
          msg.media = msg.media.map((media: any) => {
            const filename = extractFilename(media.url)
            if (filename && fileMap.has(filename)) {
              const storagePath = fileMap.get(filename)!
              const mediaUrl = getMediaUrl(storagePath)
              return { ...media, url: mediaUrl }
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

export async function processArchiveUploadJob(params: {
  jobId: string
  userId: string
  username: string
  inputStoragePath: string
}) {
  const { jobId, userId, username, inputStoragePath } = params

  let tmpPath = ''
  let createdBackupId: string | null = null

  try {
    await markBackupJobProcessing(supabase, jobId, 5, 'Downloading uploaded archive...')
    await mergeBackupJobPayload(supabase, jobId, { lifecycle_state: 'processing' })
    await ensureArchiveJobNotCancelled(jobId)

    const buffer = await downloadObjectFromR2(inputStoragePath)
    if (!buffer) {
      throw new Error('Failed to load uploaded archive payload')
    }

    tmpPath = `/tmp/archive-${jobId}.zip`
    fs.writeFileSync(tmpPath, buffer)

    await markBackupJobProgress(supabase, jobId, 15, 'Extracting archive files...')
    await ensureArchiveJobNotCancelled(jobId)

    const files: { [key: string]: string } = {}

    try {
      const entries = await listZipEntries(tmpPath)

      for (const fileName of [
        'data/account.js',
        'data/tweets.js',
        'data/tweet.js',
        'data/follower.js',
        'data/following.js',
        'data/like.js',
        'data/direct-messages.js',
      ]) {
        await ensureArchiveJobNotCancelled(jobId)
        const entry = entries.find((e) => e.fileName === fileName)
        if (!entry) continue

        const contentBuffer = await readZipEntryBufferWithLimit(
          tmpPath,
          fileName,
          TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
        )
        const content = contentBuffer ? contentBuffer.toString('utf8') : ''
        if (content) {
          files[fileName] = content
        }
      }
    } catch (error) {
      console.error('Error extracting ZIP:', error)
      throw new Error('Failed to extract archive')
    }

    await markBackupJobProgress(supabase, jobId, 30, 'Parsing archive metadata...')
    await ensureArchiveJobNotCancelled(jobId)

    const hasCoreArchiveFiles = Boolean(files['data/account.js']) || Boolean(files['data/tweets.js'] || files['data/tweet.js'])
    if (!hasCoreArchiveFiles) {
      throw new Error("This doesn't look like a Twitter archive. Upload the ZIP file downloaded from Twitter.")
    }

    const stats = { tweets: 0, followers: 0, following: 0, likes: 0, dms: 0 }

    const extractUsernameFromUrl = (url: string): string | undefined => {
      if (!url) return undefined
      const m = url.match(/^https?:\/\/(twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/?$/)
      return m ? m[2] : undefined
    }

    let accountProfile: {
      username?: string
      displayName?: string
      avatarMediaUrl?: string
      headerMediaUrl?: string
      platformUserId?: string
    } = {}

    if (files['data/account.js']) {
      const accountData = parseTwitterJSON(files['data/account.js'])
      const account = accountData[0]?.account
      if (account) {
        accountProfile = {
          username: account.username,
          displayName: account.accountDisplayName,
          avatarMediaUrl: account.avatarMediaUrl,
          headerMediaUrl: account.headerMediaUrl,
          platformUserId: account.accountId,
        }
      }
    }

    let tweets = []
    const tweetsContent = files['data/tweets.js'] || files['data/tweet.js']
    if (tweetsContent) {
      const tweetsData = parseTwitterJSON(tweetsContent)
      tweets = tweetsData
        .map((item: any) => ({
          id: item.tweet?.id_str,
          text: item.tweet?.full_text || item.tweet?.text,
          created_at: item.tweet?.created_at,
          retweet_count: item.tweet?.retweet_count,
          favorite_count: item.tweet?.favorite_count,
          extended_entities: item.tweet?.extended_entities,
          entities: item.tweet?.entities,
          media: item.tweet?.extended_entities?.media || item.tweet?.entities?.media,
          author: {
            username: accountProfile.username || username,
            name: accountProfile.displayName || username,
            profileImageUrl: accountProfile.avatarMediaUrl,
          },
        }))
        .filter((t: any) => t.id)
      stats.tweets = tweets.length
    }

    let followers = []
    if (files['data/follower.js']) {
      const followersData = parseTwitterJSON(files['data/follower.js'])
      followers = followersData
        .map((item: any) => {
          const accountId = item.follower?.accountId
          const rawLink = item.follower?.userLink || ''
          const extractedUsername = extractUsernameFromUrl(rawLink)
          return {
            user_id: accountId,
            username: extractedUsername,
            name: extractedUsername,
            userLink: rawLink || `https://twitter.com/intent/user?user_id=${accountId}`,
          }
        })
        .filter((f: any) => f.user_id)
      stats.followers = followers.length
    }

    let following = []
    if (files['data/following.js']) {
      const followingData = parseTwitterJSON(files['data/following.js'])
      following = followingData
        .map((item: any) => {
          const accountId = item.following?.accountId
          const rawLink = item.following?.userLink || ''
          const extractedUsername = extractUsernameFromUrl(rawLink)
          return {
            user_id: accountId,
            username: extractedUsername,
            name: extractedUsername,
            userLink: rawLink || `https://twitter.com/intent/user?user_id=${accountId}`,
          }
        })
        .filter((f: any) => f.user_id)
      stats.following = following.length
    }

    let likes = []
    if (files['data/like.js']) {
      const likesData = parseTwitterJSON(files['data/like.js'])
      likes = likesData
        .map((item: any) => ({
          tweet_id: item.like?.tweetId,
          full_text: item.like?.fullText,
        }))
        .filter((l: any) => l.tweet_id)
      stats.likes = likes.length
    }

    let directMessages = []
    if (files['data/direct-messages.js']) {
      const dmsData = parseTwitterJSON(files['data/direct-messages.js'])
      directMessages = dmsData
        .map((item: any) => {
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
              media: msg.messageCreate?.mediaUrls || msg.messageCreate?.media || [],
            }
          })

          return {
            conversation_id: item.dmConversation?.conversationId,
            messages: messageTexts,
            message_count: messages.length,
          }
        })
        .filter((dm: any) => dm.conversation_id)
      stats.dms = directMessages.reduce((sum: number, dm: any) => sum + dm.message_count, 0)
    }

    await markBackupJobProgress(supabase, jobId, 45, 'Saving backup record...')
    await ensureArchiveJobNotCancelled(jobId)

    const resolvedTwitterUsername = accountProfile.username || username

    const { data: socialProfile } = resolvedTwitterUsername
      ? await supabase
          .from('social_profiles')
          .upsert(
            {
              user_id: userId,
              platform: 'twitter',
              platform_username: resolvedTwitterUsername,
              platform_user_id: accountProfile.platformUserId || null,
              display_name: accountProfile.displayName || resolvedTwitterUsername,
              profile_url: `https://x.com/${resolvedTwitterUsername}`,
              added_via: 'archive',
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: 'user_id,platform,platform_username',
            },
          )
          .select('id')
          .single()
      : { data: null }

    const { data: backupData, error: backupError } = await supabase
      .from('backups')
      .insert({
        user_id: userId,
        social_profile_id: socialProfile?.id || null,
        backup_type: 'full_archive',
        source: 'archive',
        data: { tweets, followers, following, likes, direct_messages: directMessages },
      })
      .select()
      .single()

    if (backupError) {
      throw new Error(`Failed to create backup: ${backupError.message}`)
    }

    const backupId = backupData.id
    createdBackupId = backupId

    await mergeBackupJobPayload(supabase, jobId, { partial_backup_id: backupId })
    await ensureArchiveJobNotCancelled(jobId)

    await markBackupJobProgress(supabase, jobId, 55, 'Uploading archive media files...')

    const { mediaFiles, uploadedCount } = await extractMediaFiles(
      tmpPath,
      userId,
      backupId,
      async (processed, total) => {
        if (total <= 0) return
        const ratio = processed / total
        const progress = 55 + Math.round(ratio * 30)
        await markBackupJobProgress(supabase, jobId, Math.min(progress, 85), `Uploading media files (${processed}/${total})...`)
      },
      async () => ensureArchiveJobNotCancelled(jobId),
    )

    console.log(`Processed ${uploadedCount} media files (${mediaFiles.length} new records inserted)`)

    await markBackupJobProgress(supabase, jobId, 88, 'Finalizing backup data...')
    await ensureArchiveJobNotCancelled(jobId)

    const { tweets: updatedTweets, directMessages: updatedDMs } = updateMediaUrls(tweets, directMessages, mediaFiles)

    const profileMediaFiles = mediaFiles.filter((f) => f.media_type === 'profile_media')
    const getMediaUrl = (storagePath: string): string => buildInternalMediaUrl(storagePath)

    const resolveProfileMediaUrl = (cdnUrl: string | undefined): string | undefined => {
      if (!cdnUrl) return undefined
      const cdnFilename = cdnUrl.split('/').pop()?.split('?')[0]
      if (!cdnFilename) return undefined
      const matched = profileMediaFiles.find(
        (f) => f.file_name === cdnFilename || f.file_name.includes(cdnFilename.replace(/\.[^.]+$/, '')),
      )
      return matched ? getMediaUrl(matched.file_path) : undefined
    }

    const resolvedProfileImageUrl = resolveProfileMediaUrl(accountProfile.avatarMediaUrl)
    const resolvedCoverImageUrl = resolveProfileMediaUrl(accountProfile.headerMediaUrl)

    let profileImageUrl = resolvedProfileImageUrl
    let coverImageUrl = resolvedCoverImageUrl
    if (!profileImageUrl && profileMediaFiles.length > 0) {
      const avatarFile =
        profileMediaFiles.find(
          (f) => f.file_name.includes('profile_image') || f.file_name.includes('avatar') || f.file_name.includes('400x400'),
        ) || profileMediaFiles[0]
      profileImageUrl = getMediaUrl(avatarFile.file_path)
    }
    if (!coverImageUrl && profileMediaFiles.length > 1) {
      const headerFile =
        profileMediaFiles.find(
          (f) => f.file_name.includes('header') || f.file_name.includes('banner') || f.file_name.includes('cover'),
        ) || profileMediaFiles.find((f) => getMediaUrl(f.file_path) !== profileImageUrl)
      if (headerFile) coverImageUrl = getMediaUrl(headerFile.file_path)
    }

    const archiveProfile = {
      username: accountProfile.username || username,
      displayName: accountProfile.displayName || username,
      profileImageUrl: profileImageUrl || accountProfile.avatarMediaUrl,
      coverImageUrl: coverImageUrl || accountProfile.headerMediaUrl,
    }

    const updatedStats = {
      ...stats,
      media_files: mediaFiles.length,
    }

    const archiveStoragePath = `${userId}/archives/${backupId}.zip`
    await uploadObjectToR2({
      key: archiveStoragePath,
      body: buffer,
      contentType: 'application/zip',
      upsert: false,
    })

    const { data: existingArchiveRecord } = await supabase
      .from('media_files')
      .select('id')
      .eq('backup_id', backupId)
      .eq('file_path', archiveStoragePath)
      .maybeSingle()

    if (!existingArchiveRecord) {
      const archiveMetadataRecord: MediaMetadataRecord = {
        user_id: userId,
        backup_id: backupId,
        file_path: archiveStoragePath,
        file_name: `${backupId}.zip`,
        file_size: buffer.length,
        mime_type: 'application/zip',
        media_type: 'archive_file',
      }

      const { error: archiveMediaInsertError } = await supabase.from('media_files').insert(archiveMetadataRecord)
      if (archiveMediaInsertError) {
        console.error('Failed to insert archive media record:', archiveMediaInsertError)
      }
    }

    const { error: updateError } = await supabase
      .from('backups')
      .update({
        archive_file_path: archiveStoragePath,
        data: {
          tweets: updatedTweets,
          followers,
          following,
          likes,
          direct_messages: updatedDMs,
          profile: archiveProfile,
          stats: updatedStats,
          archive_file_path: archiveStoragePath,
          uploaded_file_size: buffer.length,
        },
      })
      .eq('id', backupId)

    if (updateError) {
      console.error('Failed to update backup:', updateError)
    } else {
      await recalculateAndPersistBackupStorage(supabase, backupId)
    }

    await ensureArchiveJobNotCancelled(jobId)
    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: 'completed',
      partial_backup_id: null,
    })
    await markBackupJobCompleted(supabase, jobId, backupId, 'Archive backup completed successfully.')
  } catch (error) {
    if (error instanceof JobCancelledError) {
      console.log(`[Archive Job] Cancellation requested for ${jobId}. Cleaning up...`)
      await markBackupJobCleanup(supabase, jobId, 'Cancellation requested. Cleaning up partial data...')
      if (createdBackupId) {
        try {
          await deleteBackupAndStorageById(supabase, {
            backupId: createdBackupId,
            expectedUserId: userId,
          })
        } catch (cleanupError) {
          console.error(`[Archive Job] Cleanup failed for backup ${createdBackupId}:`, cleanupError)
        }
      }
      await mergeBackupJobPayload(supabase, jobId, {
        lifecycle_state: 'cancelled',
        partial_backup_id: null,
      })
      await markBackupJobFailed(supabase, jobId, 'Cancelled by user', 'Cancelled')
      return
    }

    console.error('[Archive Job] Error:', error)
    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: 'failed',
    })
    await markBackupJobFailed(
      supabase,
      jobId,
      error instanceof Error ? error.message : 'Archive processing failed',
    )
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath)
    }

    try {
      await deleteObjectsFromR2([inputStoragePath])
    } catch (removeInputError) {
      console.warn(`[Archive Job] Failed to clean up staged input ${inputStoragePath}:`, removeInputError)
    }
  }
}
