import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { clearGuestRetention } from '@/lib/backups/retention'
import {
  SESSION_COOKIE_NAME,
  isValidSessionId,
  setActorSessionCookie,
} from '@/lib/request-actor'

type BackupRecord = {
  id: string
  data: unknown
}

type SocialProfileRecord = {
  platform: string
  platform_username: string
  platform_user_id: string | null
  display_name: string | null
  profile_url: string | null
  added_via: string | null
}

const supabase = createAdminClient()

export async function POST() {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const cookieStore = await cookies()
    const sourceActorIdRaw = cookieStore.get(SESSION_COOKIE_NAME)?.value || ''
    const sourceActorId = isValidSessionId(sourceActorIdRaw) ? sourceActorIdRaw : null

    if (!sourceActorId || sourceActorId === user.id) {
      const response = NextResponse.json({ success: true, moved: false })
      setActorSessionCookie(response, user.id)
      return response
    }

    const metadata =
      user.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
        ? (user.user_metadata as Record<string, unknown>)
        : {}
    const displayName =
      (typeof metadata.display_name === 'string' && metadata.display_name.trim())
      || (typeof metadata.full_name === 'string' && metadata.full_name.trim())
      || (typeof metadata.name === 'string' && metadata.name.trim())
      || (user.email ? user.email.split('@')[0] : 'User')

    await supabase.from('profiles').upsert(
      {
        id: user.id,
        display_name: displayName,
      },
      { onConflict: 'id' },
    )

    const { data: backups, error: backupsError } = await supabase
      .from('backups')
      .select('id, data')
      .eq('user_id', sourceActorId)

    if (backupsError) {
      throw new Error(`Failed to load source backups: ${backupsError.message}`)
    }

    for (const backup of (backups || []) as BackupRecord[]) {
      const nextData = clearGuestRetention(backup.data)
      const { error } = await supabase
        .from('backups')
        .update({
          user_id: user.id,
          data: nextData,
        })
        .eq('id', backup.id)
        .eq('user_id', sourceActorId)
      if (error) {
        throw new Error(`Failed to claim backup ${backup.id}: ${error.message}`)
      }
    }

    const [{ error: mediaError }, { error: jobsError }] = await Promise.all([
      supabase
        .from('media_files')
        .update({ user_id: user.id })
        .eq('user_id', sourceActorId),
      supabase
        .from('backup_jobs')
        .update({ user_id: user.id })
        .eq('user_id', sourceActorId),
    ])

    if (mediaError) {
      throw new Error(`Failed to claim media files: ${mediaError.message}`)
    }
    if (jobsError) {
      throw new Error(`Failed to claim backup jobs: ${jobsError.message}`)
    }

    const { data: socialProfiles, error: socialLoadError } = await supabase
      .from('social_profiles')
      .select('platform, platform_username, platform_user_id, display_name, profile_url, added_via')
      .eq('user_id', sourceActorId)

    if (socialLoadError) {
      throw new Error(`Failed to load social profiles: ${socialLoadError.message}`)
    }

    if (socialProfiles && socialProfiles.length > 0) {
      const toUpsert = (socialProfiles as SocialProfileRecord[]).map((profile) => ({
        user_id: user.id,
        platform: profile.platform,
        platform_username: profile.platform_username,
        platform_user_id: profile.platform_user_id,
        display_name: profile.display_name,
        profile_url: profile.profile_url,
        added_via: profile.added_via,
        updated_at: new Date().toISOString(),
      }))

      const { error: socialUpsertError } = await supabase
        .from('social_profiles')
        .upsert(toUpsert, {
          onConflict: 'user_id,platform,platform_username',
        })

      if (socialUpsertError) {
        throw new Error(`Failed to claim social profiles: ${socialUpsertError.message}`)
      }

      await supabase.from('social_profiles').delete().eq('user_id', sourceActorId)
    }

    const response = NextResponse.json({
      success: true,
      moved: true,
      movedBackups: backups?.length || 0,
    })
    setActorSessionCookie(response, user.id)
    return response
  } catch (error) {
    console.error('[Claim Backups] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to claim backups',
    }, { status: 500 })
  }
}
