/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import { NextResponse } from 'next/server'
import { ensureUserScopedStagedPath } from '@/lib/platforms/twitter/archive-upload-intake'
import { TWITTER_UPLOAD_LIMITS } from '@/lib/platforms/twitter/limits'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { downloadObjectFromR2, getObjectMetadataFromR2 } from '@/lib/storage/r2'
import type { ArchivePreviewData } from '@/lib/platforms/twitter/archive-import'

type PreviewBody = {
  stagedInputPath?: string
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

const MEDIA_FOLDERS = [
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

function statusForPreviewError(message: string): number {
  if (message.includes('Invalid staged upload path')) return 400
  if (message.includes('Uploaded file not found')) return 404
  if (message.includes("doesn't look like a Twitter archive")) return 400
  if (message.includes('Unauthorized')) return 401
  return 500
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
    } catch {
      // Ignore malformed segments and continue parsing remaining content.
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

export async function POST(request: Request) {
  let tmpPath = ''

  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as PreviewBody
    const stagedInputPath = ensureUserScopedStagedPath(body.stagedInputPath || '', user.id)

    const metadata = await getObjectMetadataFromR2(stagedInputPath)
    if (!metadata) {
      return NextResponse.json({ success: false, error: 'Uploaded file not found. Please retry upload.' }, { status: 404 })
    }

    const archiveBuffer = await downloadObjectFromR2(stagedInputPath)
    if (!archiveBuffer) {
      return NextResponse.json({ success: false, error: 'Uploaded file not found. Please retry upload.' }, { status: 404 })
    }

    tmpPath = `/tmp/archive-preview-${randomUUID()}.zip`
    fs.writeFileSync(tmpPath, archiveBuffer)

    const entries = await listZipEntries(tmpPath)

    const metadataEntriesByBucket: Record<ArchiveMetadataBucket, any[]> = {
      account: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.account),
      tweets: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.tweets),
      followers: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.followers),
      following: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.following),
      likes: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.likes),
      directMessages: findMetadataEntries(entries, ARCHIVE_METADATA_FILE_PATTERNS.directMessages),
    }

    const hasCoreArchiveFiles =
      metadataEntriesByBucket.account.length > 0 || metadataEntriesByBucket.tweets.length > 0
    if (!hasCoreArchiveFiles) {
      return NextResponse.json(
        { success: false, error: "This doesn't look like a Twitter archive. Upload the ZIP file downloaded from Twitter." },
        { status: 400 },
      )
    }

    const mediaEntries = entries.filter((entry: any) => {
      const relativePath = toArchiveRelativePath(entry.fileName)
      return MEDIA_FOLDERS.some((folder) => relativePath.startsWith(`${folder}/`)) && !relativePath.endsWith('/')
    })

    const stats: ArchivePreviewData['stats'] = {
      tweets: 0,
      followers: 0,
      following: 0,
      likes: 0,
      dms: 0,
      media_files: mediaEntries.length,
    }

    for (const entry of metadataEntriesByBucket.tweets) {
      const contentBuffer = await readZipEntryBufferWithLimit(
        tmpPath,
        entry.fileName,
        TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
      )
      const content = contentBuffer ? contentBuffer.toString('utf8') : ''
      if (!content) continue

      const tweets = parseTwitterJSON(content)
        .map((item: any) => item?.tweet || item)
        .filter((tweet: any) => Boolean(tweet?.id_str || tweet?.id))
      stats.tweets += tweets.length
    }

    for (const entry of metadataEntriesByBucket.followers) {
      const contentBuffer = await readZipEntryBufferWithLimit(
        tmpPath,
        entry.fileName,
        TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
      )
      const content = contentBuffer ? contentBuffer.toString('utf8') : ''
      if (!content) continue

      const followers = parseTwitterJSON(content).filter((item: any) => Boolean(item?.follower?.accountId))
      stats.followers += followers.length
    }

    for (const entry of metadataEntriesByBucket.following) {
      const contentBuffer = await readZipEntryBufferWithLimit(
        tmpPath,
        entry.fileName,
        TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
      )
      const content = contentBuffer ? contentBuffer.toString('utf8') : ''
      if (!content) continue

      const following = parseTwitterJSON(content).filter((item: any) => Boolean(item?.following?.accountId))
      stats.following += following.length
    }

    for (const entry of metadataEntriesByBucket.likes) {
      const contentBuffer = await readZipEntryBufferWithLimit(
        tmpPath,
        entry.fileName,
        TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
      )
      const content = contentBuffer ? contentBuffer.toString('utf8') : ''
      if (!content) continue

      const likes = parseTwitterJSON(content).filter((item: any) => Boolean(item?.like?.tweetId))
      stats.likes += likes.length
    }

    for (const entry of metadataEntriesByBucket.directMessages) {
      const contentBuffer = await readZipEntryBufferWithLimit(
        tmpPath,
        entry.fileName,
        TWITTER_UPLOAD_LIMITS.maxMetadataEntryBytes,
      )
      const content = contentBuffer ? contentBuffer.toString('utf8') : ''
      if (!content) continue

      const dmsData = parseTwitterJSON(content)
      const messageCount = dmsData.reduce((sum: number, item: any) => {
        const messages = item?.dmConversation?.messages
        if (!Array.isArray(messages)) return sum
        return sum + messages.length
      }, 0)
      stats.dms += messageCount
    }

    const preview: ArchivePreviewData = {
      stats,
      available: {
        tweets: metadataEntriesByBucket.tweets.length > 0,
        followers: metadataEntriesByBucket.followers.length > 0,
        following: metadataEntriesByBucket.following.length > 0,
        likes: metadataEntriesByBucket.likes.length > 0,
        direct_messages: metadataEntriesByBucket.directMessages.length > 0,
        media: mediaEntries.length > 0,
      },
    }

    return NextResponse.json({ success: true, preview })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to inspect uploaded archive'
    const status = statusForPreviewError(message)
    const clientMessage = status >= 500 ? 'Failed to inspect uploaded archive' : message
    console.error('[Archive Preview] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath)
    }
  }
}
