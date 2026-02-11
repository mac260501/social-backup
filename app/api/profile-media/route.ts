import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { verifyMediaOwnership } from '@/lib/auth-helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    // Identify profile image vs cover photo by filename heuristics (same logic as upload)
    const avatarFile = profileFiles.find(f =>
      f.file_name.includes('profile_image') || f.file_name.includes('avatar') || f.file_name.includes('400x400')
    ) || profileFiles[0]

    const headerFile = profileFiles.find(f =>
      f.file_name.includes('header') || f.file_name.includes('banner') || f.file_name.includes('cover')
    ) || (profileFiles.length > 1 ? profileFiles.find(f => f.file_path !== avatarFile.file_path) : null)

    const signedUrlExpiry = 3600

    const [avatarSigned, headerSigned] = await Promise.all([
      supabase.storage.from('twitter-media').createSignedUrl(avatarFile.file_path, signedUrlExpiry),
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
