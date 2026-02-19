import { NextResponse } from 'next/server'
import { verifyMediaOwnership } from '@/lib/auth-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'

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

function parseStoragePathFromUrl(url: string): string | null {
  const clean = url.split('?')[0]
  const publicMarker = '/storage/v1/object/public/twitter-media/'
  const signedMarker = '/storage/v1/object/sign/twitter-media/'
  const objectMarker = '/storage/v1/object/twitter-media/'

  if (clean.includes(publicMarker)) return clean.split(publicMarker)[1] || null
  if (clean.includes(signedMarker)) return clean.split(signedMarker)[1] || null
  if (clean.includes(objectMarker)) return clean.split(objectMarker)[1] || null
  return null
}

async function resolveCandidateToUrl(candidate: string | null, signedUrlExpiry = 3600): Promise<string | null> {
  if (!candidate) return null
  if (candidate.startsWith('http://') || candidate.startsWith('https://') || candidate.startsWith('data:')) {
    return candidate
  }

  const storagePath = parseStoragePathFromUrl(candidate) || candidate.replace(/^\/+/, '')
  if (!storagePath) return null

  const { data: signedData } = await supabase.storage
    .from('twitter-media')
    .createSignedUrl(storagePath, signedUrlExpiry)

  if (signedData?.signedUrl) return signedData.signedUrl

  const { data: publicData } = supabase.storage.from('twitter-media').getPublicUrl(storagePath)
  return publicData?.publicUrl || null
}

export async function GET(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'Backup ID is required' }, { status: 400 })
    }

    const isOwner = await verifyMediaOwnership(backupId, user.id)
    if (!isOwner) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    // Fetch the backup to get the stored profile image URLs (so we know which file is which)
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

    // Fetch media files for this backup. We avoid filtering on legacy columns
    // (e.g. media_type) because newer schemas may not include them.
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
    const profileFiles = mediaFileList.filter(f => looksLikeProfileMedia(f.file_path, f.file_name))
    const candidateFiles = profileFiles.length > 0 ? profileFiles : mediaFileList

    // Match by filename extracted from stored URL — exact, then partial, then heuristic fallback
    const findFile = (filename: string | null, excludePath?: string) => {
      if (filename) {
        const exact = candidateFiles.find(f => f.file_name === filename && (!excludePath || f.file_path !== excludePath))
        if (exact) return exact
        const baseName = filename.replace(/\.[^.]+$/, '')
        const partial = candidateFiles.find(
          f =>
            (!excludePath || f.file_path !== excludePath) &&
            (f.file_name.includes(baseName) || baseName.includes(f.file_name.replace(/\.[^.]+$/, '')))
        )
        if (partial) return partial
      }
      return null
    }

    let avatarFile = findFile(storedProfileImageFilename)
    let headerFile = findFile(storedCoverImageFilename)

    // Heuristic fallback if URL-based matching didn't work
    if (!avatarFile) {
      avatarFile = candidateFiles.find(f =>
        f.file_name.includes('profile_image') || f.file_name.includes('avatar') || f.file_name.includes('400x400')
      ) || null
    }
    if (!headerFile) {
      headerFile = candidateFiles.find(f =>
        f.file_name.includes('header') || f.file_name.includes('banner') || f.file_name.includes('cover')
      ) || null
    }

    // Last resort: assign by position if we have two files and still missing one
    if (!avatarFile && !headerFile) {
      avatarFile = candidateFiles[0]
      headerFile = candidateFiles.length > 1 ? candidateFiles[1] : null
    } else if (!avatarFile && headerFile) {
      avatarFile = candidateFiles.find(f => f.file_path !== headerFile!.file_path) || null
    } else if (avatarFile && !headerFile) {
      headerFile = candidateFiles.find(f => f.file_path !== avatarFile!.file_path) || null
    }

    const signedUrlExpiry = 3600

    let avatarFilePath = avatarFile?.file_path || null
    let headerFilePath = headerFile?.file_path || null

    const hasExplicitProfileReference = Boolean(
      storedProfileImageFilename ||
      storedCoverImageFilename ||
      profile?.profileImageUrl ||
      profile?.profile_image_url_https ||
      profile?.profile_image_url ||
      profile?.coverImageUrl ||
      profile?.bannerImageUrl ||
      profile?.profile_banner_url
    )

    // Important guardrail:
    // snapshots that did not include profile data should not inherit profile images
    // from a previous backup via broad storage-folder fallback.
    if (
      isProfileIncludedInSnapshot === false &&
      !hasExplicitProfileReference &&
      candidateFiles.length === 0
    ) {
      return NextResponse.json({
        success: true,
        profileImageUrl: null,
        coverImageUrl: null,
      })
    }

    // Fallback: if media_files matching is incomplete, inspect storage folders directly.
    const shouldUseStorageFolderFallback =
      isProfileIncludedInSnapshot !== false &&
      (!avatarFilePath || !headerFilePath) &&
      (candidateFiles.length > 0 || hasExplicitProfileReference)

    if (shouldUseStorageFolderFallback) {
      const backupOwnerId = typeof backup.user_id === 'string' ? backup.user_id : user.id
      const mediaFolders = [`${backupOwnerId}/profile_media`, `${backupOwnerId}/profiles_media`]

      const listedFiles = (
        await Promise.all(
          mediaFolders.map(async (folder) => {
            const { data } = await supabase.storage.from('twitter-media').list(folder, {
              limit: 100,
              sortBy: { column: 'name', order: 'desc' },
            })
            return (data || [])
              .filter((entry) => !!entry.name && !entry.name.endsWith('/'))
              .map((entry) => ({ file_path: `${folder}/${entry.name}`, file_name: entry.name }))
          })
        )
      ).flat()

      if (!avatarFilePath) {
        const storageAvatar = listedFiles.find(
          (f) =>
            f.file_name.includes('profile_image') ||
            f.file_name.includes('avatar') ||
            f.file_name.includes('400x400')
        )
        avatarFilePath = storageAvatar?.file_path || listedFiles[0]?.file_path || null
      }

      if (!headerFilePath) {
        const storageHeader = listedFiles.find(
          (f) =>
            f.file_name.includes('header') ||
            f.file_name.includes('banner') ||
            f.file_name.includes('cover')
        )
        headerFilePath =
          storageHeader?.file_path ||
          listedFiles.find((f) => f.file_path !== avatarFilePath)?.file_path ||
          null
      }
    }

    const [avatarSigned, headerSigned] = await Promise.all([
      avatarFilePath
        ? supabase.storage.from('twitter-media').createSignedUrl(avatarFilePath, signedUrlExpiry)
        : Promise.resolve({ data: null }),
      headerFilePath
        ? supabase.storage.from('twitter-media').createSignedUrl(headerFilePath, signedUrlExpiry)
        : Promise.resolve({ data: null }),
    ])

    // Fallback to profile URLs embedded in backup payload when media-file matching doesn't resolve.
    const firstTweetWithAvatar =
      backup.data?.tweets?.find((tweet: unknown) => {
        const t = tweet as Record<string, unknown>
        const author = t.author as Record<string, unknown> | undefined
        const user = t.user as Record<string, unknown> | undefined
        return Boolean(
          (author && typeof author.profileImageUrl === 'string' && author.profileImageUrl) ||
          (user && typeof user.profile_image_url_https === 'string' && user.profile_image_url_https) ||
          (user && typeof user.profile_image_url === 'string' && user.profile_image_url)
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
      resolveCandidateToUrl(avatarFallbackCandidate, signedUrlExpiry),
      resolveCandidateToUrl(coverFallbackCandidate, signedUrlExpiry),
    ])

    return NextResponse.json({
      success: true,
      profileImageUrl: avatarSigned.data?.signedUrl || avatarFallbackUrl || null,
      coverImageUrl: headerSigned.data?.signedUrl || coverFallbackUrl || null,
    })
  } catch (error) {
    console.error('Error fetching profile media:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch profile media' },
      { status: 500 }
    )
  }
}
