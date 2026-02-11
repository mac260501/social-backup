import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { verifyMediaOwnership } from '@/lib/auth-helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function extractFilename(url: string | undefined): string | null {
  if (!url) return null
  return url.split('/').pop()?.split('?')[0] || null
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'Backup ID is required' }, { status: 400 })
    }

    const isOwner = await verifyMediaOwnership(backupId, session.user.id)
    if (!isOwner) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    // Fetch the backup to get the stored profile image URLs (so we know which file is which)
    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('data')
      .eq('id', backupId)
      .single()

    if (backupError || !backup) {
      throw backupError || new Error('Backup not found')
    }

    const profile = backup.data?.profile
    const storedProfileImageFilename = extractFilename(profile?.profileImageUrl)
    const storedCoverImageFilename = extractFilename(profile?.coverImageUrl)

    // Fetch all profile_media files for this backup
    const { data: profileFiles, error } = await supabase
      .from('media_files')
      .select('file_path, file_name')
      .eq('backup_id', backupId)
      .eq('media_type', 'profile_media')

    if (error) {
      throw error
    }

    if (!profileFiles || profileFiles.length === 0) {
      return NextResponse.json({ success: true, profileImageUrl: null, coverImageUrl: null })
    }

    // Match by filename extracted from stored URL — exact, then partial, then heuristic fallback
    const findFile = (filename: string | null, excludePath?: string) => {
      if (filename) {
        const exact = profileFiles.find(f => f.file_name === filename)
        if (exact) return exact
        const baseName = filename.replace(/\.[^.]+$/, '')
        const partial = profileFiles.find(f => f.file_name.includes(baseName) || baseName.includes(f.file_name.replace(/\.[^.]+$/, '')))
        if (partial) return partial
      }
      return null
    }

    let avatarFile = findFile(storedProfileImageFilename)
    let headerFile = findFile(storedCoverImageFilename)

    // Heuristic fallback if URL-based matching didn't work
    if (!avatarFile) {
      avatarFile = profileFiles.find(f =>
        f.file_name.includes('profile_image') || f.file_name.includes('avatar') || f.file_name.includes('400x400')
      ) || null
    }
    if (!headerFile) {
      headerFile = profileFiles.find(f =>
        f.file_name.includes('header') || f.file_name.includes('banner') || f.file_name.includes('cover')
      ) || null
    }

    // Last resort: assign by position if we have two files and still missing one
    if (!avatarFile && !headerFile) {
      avatarFile = profileFiles[0]
      headerFile = profileFiles.length > 1 ? profileFiles[1] : null
    } else if (!avatarFile && headerFile) {
      avatarFile = profileFiles.find(f => f.file_path !== headerFile!.file_path) || null
    } else if (avatarFile && !headerFile) {
      headerFile = profileFiles.find(f => f.file_path !== avatarFile!.file_path) || null
    }

    const signedUrlExpiry = 3600

    const [avatarSigned, headerSigned] = await Promise.all([
      avatarFile
        ? supabase.storage.from('twitter-media').createSignedUrl(avatarFile.file_path, signedUrlExpiry)
        : Promise.resolve({ data: null }),
      headerFile
        ? supabase.storage.from('twitter-media').createSignedUrl(headerFile.file_path, signedUrlExpiry)
        : Promise.resolve({ data: null }),
    ])

    return NextResponse.json({
      success: true,
      profileImageUrl: avatarSigned.data?.signedUrl || null,
      coverImageUrl: headerSigned.data?.signedUrl || null,
    })
  } catch (error) {
    console.error('Error fetching profile media:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch profile media' },
      { status: 500 }
    )
  }
}
