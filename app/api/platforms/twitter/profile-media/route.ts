import { NextResponse } from 'next/server'
import { verifyMediaOwnership } from '@/lib/auth-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestActorId } from '@/lib/request-actor'
import { getShareGrantFromCookies } from '@/lib/share-links'
import { buildInternalMediaUrl } from '@/lib/storage/media-url'
import { parseLegacyStoragePath } from '@/lib/storage/r2'

const supabase = createAdminClient()

function extractFilename(url: string | undefined): string | null {
  if (!url) return null
  return url.split('/').pop()?.split('?')[0] || null
}

function getStringAtPath(source: unknown, path: string[]): string | null {
  let current: unknown = source
  for (const key of path) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null
}

function parseSnapshotProfileIncluded(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const targets = value as Record<string, unknown>
  if (!('profile' in targets)) return null
  return Boolean(targets.profile)
}

async function resolveCandidateToUrl(candidate: string | null): Promise<string | null> {
  if (!candidate) return null

  if (candidate.startsWith('/')) return candidate

  if (candidate.startsWith('http://') || candidate.startsWith('https://') || candidate.startsWith('data:')) {
    return candidate
  }

  const storagePath = parseLegacyStoragePath(candidate)
  if (!storagePath) return null
  return buildInternalMediaUrl(storagePath)
}

export async function GET(request: Request) {
  try {
    const actorId = await getRequestActorId()
    const shareGrant = await getShareGrantFromCookies()
    if (!actorId && !shareGrant) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'Backup ID is required' }, { status: 400 })
    }

    const isOwner = actorId ? await verifyMediaOwnership(backupId, actorId) : false
    const hasShareAccess = Boolean(shareGrant && shareGrant.backupId === backupId)
    if (!isOwner && !hasShareAccess) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('data, user_id')
      .eq('id', backupId)
      .single()

    if (backupError || !backup) {
      throw backupError || new Error('Backup not found')
    }

    const profile = backup.data?.profile
    const storedProfileImageFilename = extractFilename(profile?.profileImageUrl)
    const storedCoverImageFilename = extractFilename(profile?.coverImageUrl)
    const isProfileIncludedInSnapshot = parseSnapshotProfileIncluded(backup.data?.scrape?.targets)

    const { data: backupMediaFiles, error } = await supabase
      .from('media_files')
      .select('file_path, file_name')
      .eq('backup_id', backupId)

    if (error) {
      throw error
    }

    const looksLikeProfileMedia = (filePath?: string, fileName?: string) => {
      const path = (filePath || '').toLowerCase()
      const name = (fileName || '').toLowerCase()
      return (
        path.includes('/profile_media/') ||
        path.includes('_media/profile_') ||
        name.includes('profile') ||
        name.includes('avatar') ||
        name.includes('400x400') ||
        name.includes('header') ||
        name.includes('banner') ||
        name.includes('cover')
      )
    }

    const mediaFileList = backupMediaFiles || []
    const profileFiles = mediaFileList.filter((f) => looksLikeProfileMedia(f.file_path, f.file_name))
    const candidateFiles = profileFiles.length > 0 ? profileFiles : mediaFileList

    const findFile = (filename: string | null, excludePath?: string) => {
      if (filename) {
        const exact = candidateFiles.find((f) => f.file_name === filename && (!excludePath || f.file_path !== excludePath))
        if (exact) return exact
        const baseName = filename.replace(/\.[^.]+$/, '')
        const partial = candidateFiles.find(
          (f) =>
            (!excludePath || f.file_path !== excludePath) &&
            (f.file_name.includes(baseName) || baseName.includes(f.file_name.replace(/\.[^.]+$/, ''))),
        )
        if (partial) return partial
      }
      return null
    }

    let avatarFile = findFile(storedProfileImageFilename)
    let headerFile = findFile(storedCoverImageFilename)

    if (!avatarFile) {
      avatarFile =
        candidateFiles.find(
          (f) => f.file_name.includes('profile_image') || f.file_name.includes('avatar') || f.file_name.includes('400x400'),
        ) || null
    }
    if (!headerFile) {
      headerFile =
        candidateFiles.find((f) => f.file_name.includes('header') || f.file_name.includes('banner') || f.file_name.includes('cover')) || null
    }

    if (!avatarFile && !headerFile) {
      avatarFile = candidateFiles[0]
      headerFile = candidateFiles.length > 1 ? candidateFiles[1] : null
    } else if (!avatarFile && headerFile) {
      avatarFile = candidateFiles.find((f) => f.file_path !== headerFile!.file_path) || null
    } else if (avatarFile && !headerFile) {
      headerFile = candidateFiles.find((f) => f.file_path !== avatarFile!.file_path) || null
    }

    const avatarFilePath = avatarFile?.file_path || null
    const headerFilePath = headerFile?.file_path || null

    const hasExplicitProfileReference = Boolean(
      storedProfileImageFilename ||
        storedCoverImageFilename ||
        profile?.profileImageUrl ||
        profile?.profile_image_url_https ||
        profile?.profile_image_url ||
        profile?.coverImageUrl ||
        profile?.bannerImageUrl ||
        profile?.profile_banner_url,
    )

    if (isProfileIncludedInSnapshot === false && !hasExplicitProfileReference && candidateFiles.length === 0) {
      return NextResponse.json({
        success: true,
        profileImageUrl: null,
        coverImageUrl: null,
      })
    }

    const firstTweetWithAvatar =
      backup.data?.tweets?.find((tweet: unknown) => {
        const t = tweet as Record<string, unknown>
        const author = t.author as Record<string, unknown> | undefined
        const userTweet = t.user as Record<string, unknown> | undefined
        return Boolean(
          (author && typeof author.profileImageUrl === 'string' && author.profileImageUrl) ||
            (userTweet && typeof userTweet.profile_image_url_https === 'string' && userTweet.profile_image_url_https) ||
            (userTweet && typeof userTweet.profile_image_url === 'string' && userTweet.profile_image_url),
        )
      }) || null

    const avatarFallbackCandidate =
      profile?.profileImageUrl ||
      profile?.profile_image_url_https ||
      profile?.profile_image_url ||
      getStringAtPath(backup, ['data', 'profileImageUrl']) ||
      getStringAtPath(backup, ['data', 'accountProfile', 'avatarMediaUrl']) ||
      getStringAtPath(firstTweetWithAvatar, ['author', 'profileImageUrl']) ||
      getStringAtPath(firstTweetWithAvatar, ['user', 'profile_image_url_https']) ||
      getStringAtPath(firstTweetWithAvatar, ['user', 'profile_image_url'])

    const coverFallbackCandidate =
      profile?.coverImageUrl ||
      profile?.bannerImageUrl ||
      profile?.profile_banner_url ||
      getStringAtPath(backup, ['data', 'coverImageUrl']) ||
      getStringAtPath(backup, ['data', 'accountProfile', 'headerMediaUrl'])

    const [avatarFallbackUrl, coverFallbackUrl] = await Promise.all([
      resolveCandidateToUrl(avatarFallbackCandidate),
      resolveCandidateToUrl(coverFallbackCandidate),
    ])

    return NextResponse.json({
      success: true,
      profileImageUrl: avatarFilePath ? buildInternalMediaUrl(avatarFilePath) : avatarFallbackUrl || null,
      coverImageUrl: headerFilePath ? buildInternalMediaUrl(headerFilePath) : coverFallbackUrl || null,
    })
  } catch (error) {
    console.error('Error fetching profile media:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch profile media' }, { status: 500 })
  }
}
