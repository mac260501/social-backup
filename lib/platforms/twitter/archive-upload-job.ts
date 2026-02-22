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

type ArchiveMetadataBucket =
  | 'account'
  | 'tweets'
  | 'followers'
  | 'following'
  | 'likes'
  | 'directMessages'

const ARCHIVE_METADATA_FILE_PATTERNS: Record<ArchiveMetadataBucket, RegExp[]> = {
  account: [/^data\/account(?:-part\d+)?\.js$/i],
  tweets: [/^data\/tweets?(?:-part\d+)?\.js$/i],
  followers: [/^data\/followers?(?:-part\d+)?\.js$/i],
  following: [/^data\/following(?:-part\d+)?\.js$/i],
  likes: [/^data\/likes?(?:-part\d+)?\.js$/i],
  directMessages: [
    /^data\/direct-messages(?:-part\d+)?\.js$/i,
    /^data\/direct_messages(?:-part\d+)?\.js$/i,
  ],
}

function normalizeZipEntryName(fileName: string): string {
  return fileName.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function toArchiveRelativePath(fileName: string): string {
  const normalized = normalizeZipEntryName(fileName)
  const dataIndex = normalized.toLowerCase().indexOf('data/')
  if (dataIndex < 0) return normalized
  return normalized.slice(dataIndex)
}

function extractPartNumber(fileName: string): number {
  const match = /-part(\d+)\.js$/i.exec(fileName)
  if (!match) return 0
  return Number.parseInt(match[1], 10) || 0
}

function findMetadataEntries(entries: any[], patterns: RegExp[]): any[] {
  return entries
    .filter((entry: any) => {
      if (!entry || typeof entry.fileName !== 'string') return false
      const relativePath = toArchiveRelativePath(entry.fileName)
      return patterns.some((pattern) => pattern.test(relativePath))
    })
    .sort((a: any, b: any) => {
      const relA = toArchiveRelativePath(a.fileName)
      const relB = toArchiveRelativePath(b.fileName)
      const partA = extractPartNumber(relA)
      const partB = extractPartNumber(relB)
      if (partA !== partB) return partA - partB
      return relA.localeCompare(relB)
    })
}

function extractJsonLiteral(content: string, startIndex: number): { value: string; endIndex: number } | null {
  const opening = content[startIndex]
  if (opening !== '[' && opening !== '{') return null

  const stack: string[] = [opening]
  let inString = false
  let escaped = false

  for (let i = startIndex + 1; i < content.length; i += 1) {
    const char = content[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '[' || char === '{') {
      stack.push(char)
      continue
    }

    if (char === ']' || char === '}') {
      const expected = char === ']' ? '[' : '{'
      const top = stack[stack.length - 1]
      if (top !== expected) continue
      stack.pop()
      if (stack.length === 0) {
        return {
          value: content.slice(startIndex, i + 1),
          endIndex: i,
        }
      }
    }
  }

  return null
}

function isMissingColumnError(error: unknown, columnName?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  const message = String((error as { message?: unknown }).message || '')
  const normalizedMessage = message.toLowerCase()
  const normalizedCode = typeof code === 'string' ? code.toUpperCase() : ''

  const isPostgresMissingColumn =
    normalizedCode === '42703' || /column .* does not exist/i.test(message)

  const isPostgrestMissingColumn =
    normalizedCode.startsWith('PGRST') &&
    normalizedMessage.includes('could not find') &&
    normalizedMessage.includes('column')

  if (!isPostgresMissingColumn && !isPostgrestMissingColumn) {
    return false
  }
  if (!columnName) return true
  return normalizedMessage.includes(columnName.toLowerCase())
}

async function insertMediaFileRecord(record: MediaMetadataRecord): Promise<boolean> {
  const basePayload = {
    user_id: record.user_id,
    backup_id: record.backup_id,
    file_path: record.file_path,
    file_name: record.file_name,
    file_size: record.file_size,
  }

  const attempts: Array<Record<string, unknown>> = [
    { ...basePayload, mime_type: record.mime_type, media_type: record.media_type },
    { ...basePayload, mime_type: record.mime_type },
    { ...basePayload, file_type: record.mime_type, media_type: record.media_type },
    { ...basePayload, file_type: record.mime_type },
    { ...basePayload, media_type: record.media_type },
    basePayload,
  ]

  let lastError: unknown = null
  const seenPayloads = new Set<string>()

  for (const payload of attempts) {
    const signature = Object.keys(payload).sort().join('|')
    if (seenPayloads.has(signature)) continue
    seenPayloads.add(signature)

    const { error } = await supabase.from('media_files').insert(payload)
    if (!error) {
      return true
    }

    lastError = error
    if (!isMissingColumnError(error)) {
      console.error('[Archive Job] Failed to insert media record:', error)
      return false
    }
  }

  if (lastError) {
    console.error('[Archive Job] Failed to insert media record after schema fallbacks:', lastError)
  }
  return false
}

function parseTwitterJSON(content: string) {
  const normalized = content.replace(/^\uFEFF/, '')
  const parsedSegments: any[] = []

  const assignmentRegex = /=\s*([\[{])/g
  while (true) {
    const nextMatch = assignmentRegex.exec(normalized)
    if (!nextMatch) break
    const startIndex = assignmentRegex.lastIndex - 1
    const extracted = extractJsonLiteral(normalized, startIndex)
    if (!extracted) {
      assignmentRegex.lastIndex = Math.max(assignmentRegex.lastIndex, startIndex + 1)
      continue
    }

    try {
      const parsed = JSON.parse(extracted.value)
      if (Array.isArray(parsed)) parsedSegments.push(...parsed)
      else if (parsed && typeof parsed === 'object') parsedSegments.push(parsed)
    } catch (error) {
      console.warn('[Archive Job] Failed to parse archive assignment JSON segment:', error)
    }

    assignmentRegex.lastIndex = extracted.endIndex + 1
  }

  if (parsedSegments.length > 0) {
    return parsedSegments
  }

  const trimmed = normalized.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
  } catch {
    // no-op
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

  const mediaEntries = entries.filter((entry: any) => {
    const relativePath = toArchiveRelativePath(entry.fileName)
    return mediaFolders.some((folder) => relativePath.startsWith(`${folder}/`)) && !relativePath.endsWith('/')
  })

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

      const relativePath = toArchiveRelativePath(entry.fileName)
      const mediaType = relativePath.split('/')[1] || 'unknown_media'
      const fileName = (relativePath.split('/').pop() || relativePath).replace(/\\/g, '_')
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
      } else if (await insertMediaFileRecord(metadataRecord)) {
        mediaFiles.push(metadataRecord)
        uploadedCount++
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

    const files: Record<ArchiveMetadataBucket, string[]> = {
      account: [],
      tweets: [],
      followers: [],
      following: [],
      likes: [],
      directMessages: [],
    }

    try {
      const entries = await listZipEntries(tmpPath)

      const metadataEntriesByBucket: Record<ArchiveMetadataBucket, any[]> = {
        account: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.account),
        tweets: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.tweets),
        followers: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.followers),
        following: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.following),
        likes: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.likes),
        directMessages: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.directMessages),
      }

      for (const [bucket, bucketEntries] of Object.entries(metadataEntriesByBucket) as Array<[
        ArchiveMetadataBucket,
        any[],
      ]>) {
        for (const entry of bucketEntries) {
          await ensureArchiveJobNotCancelled(jobId)

          const contentBuffer = await readZipEntryBufferWithLimit(
            tmpPath,
            entry.fileName,
            TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
          )
          const content = contentBuffer ? contentBuffer.toString('utf8') : ''
          if (content) {
            files[bucket].push(content)
          }
        }
      }
    } catch (error) {
      console.error('Error extracting ZIP:', error)
      throw new Error('Failed to extract archive')
    }

    await markBackupJobProgress(supabase, jobId, 30, 'Parsing archive metadata...')
    await ensureArchiveJobNotCancelled(jobId)

    const hasCoreArchiveFiles = files.account.length > 0 || files.tweets.length > 0
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

    if (files.account.length > 0) {
      const accountData = files.account.flatMap(parseTwitterJSON)
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

    let tweets: any[] = []
    if (files.tweets.length > 0) {
      const tweetsData = files.tweets.flatMap(parseTwitterJSON)
      tweets = tweetsData
        .map((item: any) => {
          const tweet = item?.tweet || item
          const tweetId = tweet?.id_str || tweet?.id
          const authorUsername = accountProfile.username || username
          return {
            id: tweetId,
            id_str: tweet?.id_str || (tweetId ? String(tweetId) : undefined),
            text: tweet?.full_text || tweet?.text,
            full_text: tweet?.full_text || tweet?.text,
            created_at: tweet?.created_at,
            retweet_count: tweet?.retweet_count,
            favorite_count: tweet?.favorite_count,
            reply_count: tweet?.reply_count,
            quote_count: tweet?.quote_count,
            conversation_id_str: tweet?.conversation_id_str,
            in_reply_to_status_id: tweet?.in_reply_to_status_id_str || tweet?.in_reply_to_status_id || null,
            in_reply_to_status_id_str: tweet?.in_reply_to_status_id_str || null,
            in_reply_to_user_id: tweet?.in_reply_to_user_id_str || tweet?.in_reply_to_user_id || null,
            in_reply_to_user_id_str: tweet?.in_reply_to_user_id_str || null,
            in_reply_to_screen_name: tweet?.in_reply_to_screen_name || null,
            extended_entities: tweet?.extended_entities,
            entities: tweet?.entities,
            media: tweet?.extended_entities?.media || tweet?.entities?.media,
            tweet_url: tweetId && authorUsername ? `https://x.com/${authorUsername}/status/${tweetId}` : undefined,
            author: {
              username: authorUsername,
              name: accountProfile.displayName || username,
              profileImageUrl: accountProfile.avatarMediaUrl,
            },
          }
        })
        .filter((t: any) => t.id)
      stats.tweets = tweets.length
    }

    let followers: any[] = []
    if (files.followers.length > 0) {
      const followersData = files.followers.flatMap(parseTwitterJSON)
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

    let following: any[] = []
    if (files.following.length > 0) {
      const followingData = files.following.flatMap(parseTwitterJSON)
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

    let likes: any[] = []
    if (files.likes.length > 0) {
      const likesData = files.likes.flatMap(parseTwitterJSON)
      likes = likesData
        .map((item: any) => ({
          tweet_id: item.like?.tweetId,
          full_text: item.like?.fullText,
        }))
        .filter((l: any) => l.tweet_id)
      stats.likes = likes.length
    }

    let directMessages: any[] = []
    if (files.directMessages.length > 0) {
      const dmsData = files.directMessages.flatMap(parseTwitterJSON)
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

      if (!(await insertMediaFileRecord(archiveMetadataRecord))) {
        console.error('Failed to insert archive media record after fallback attempts')
      }
    }

    const backupDataUpdate = {
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
    }

    let { error: updateError } = await supabase
      .from('backups')
      .update({
        ...backupDataUpdate,
        archive_file_path: archiveStoragePath,
      })
      .eq('id', backupId)

    if (updateError && isMissingColumnError(updateError, 'archive_file_path')) {
      console.warn('[Archive Job] backups.archive_file_path missing; retrying update without top-level column')
      const retryResult = await supabase
        .from('backups')
        .update(backupDataUpdate)
        .eq('id', backupId)
      updateError = retryResult.error
    }

    if (updateError) {
      throw new Error(`Failed to finalize archive backup record: ${updateError.message}`)
    }

    await recalculateAndPersistBackupStorage(supabase, backupId)

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
