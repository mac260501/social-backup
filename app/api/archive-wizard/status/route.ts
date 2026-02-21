import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isArchiveWizardStatus,
  resolveArchiveWizardStep,
  type ArchiveWizardStatus,
  type ArchiveWizardStatusResponse,
} from '@/lib/archive-wizard/types'

const supabase = createAdminClient()

type ProfileArchiveFields = {
  archive_request_status: string | null
  archive_requested_at: string | null
  archive_reminder_count: number | null
  archive_last_reminder_at: string | null
}

type BackupRecord = {
  id: string
  data?: {
    stats?: {
      tweets?: number
      followers?: number
      following?: number
      likes?: number
      dms?: number
      media_files?: number
    }
  } | null
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function normalizeBackupStats(backup: BackupRecord | null) {
  const stats = backup?.data?.stats
  if (!stats) return null

  return {
    tweets: parseNumber(stats.tweets),
    followers: parseNumber(stats.followers),
    following: parseNumber(stats.following),
    likes: parseNumber(stats.likes),
    dms: parseNumber(stats.dms),
    mediaFiles: parseNumber(stats.media_files),
  }
}

function isMissingArchiveSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) return false
  if (error.code === '42703') return true
  return (error.message || '').toLowerCase().includes('archive_request_')
}

async function getArchiveStatusForUser(userId: string): Promise<ArchiveWizardStatusResponse> {
  let schemaReady = true

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('archive_request_status, archive_requested_at, archive_reminder_count, archive_last_reminder_at')
    .eq('id', userId)
    .maybeSingle<ProfileArchiveFields>()

  if (profileError && isMissingArchiveSchemaError(profileError)) {
    schemaReady = false
  } else if (profileError) {
    throw new Error(`Failed to load archive wizard profile state: ${profileError.message}`)
  }

  const { count: archiveBackupCount, error: backupCountError } = await supabase
    .from('backups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', 'archive')

  if (backupCountError) {
    throw new Error(`Failed to load archive backup count: ${backupCountError.message}`)
  }

  const hasArchiveBackup = (archiveBackupCount || 0) > 0

  const { data: latestArchiveBackup, error: latestArchiveError } = await supabase
    .from('backups')
    .select('id, data')
    .eq('user_id', userId)
    .eq('source', 'archive')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle<BackupRecord>()

  if (latestArchiveError) {
    throw new Error(`Failed to load latest archive backup: ${latestArchiveError.message}`)
  }

  const { data: activeArchiveJob, error: activeJobError } = await supabase
    .from('backup_jobs')
    .select('id, status, progress, message, result_backup_id')
    .eq('user_id', userId)
    .eq('job_type', 'archive_upload')
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeJobError) {
    throw new Error(`Failed to load active archive job: ${activeJobError.message}`)
  }

  const status = isArchiveWizardStatus(profileData?.archive_request_status)
    ? (profileData?.archive_request_status as ArchiveWizardStatus)
    : null

  return {
    success: true,
    schemaReady,
    status,
    archiveRequestedAt: profileData?.archive_requested_at ?? null,
    archiveReminderCount: parseNumber(profileData?.archive_reminder_count),
    archiveLastReminderAt: profileData?.archive_last_reminder_at ?? null,
    hasArchiveBackup,
    suggestedStep: resolveArchiveWizardStep({
      status,
      hasArchiveBackup,
      hasActiveArchiveJob: Boolean(activeArchiveJob),
    }),
    activeArchiveJob,
    latestArchiveBackupId: latestArchiveBackup?.id ?? null,
    latestArchiveBackupStats: normalizeBackupStats(latestArchiveBackup ?? null),
  }
}

export async function GET() {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const status = await getArchiveStatusForUser(user.id)
    return NextResponse.json(status)
  } catch (error) {
    console.error('[Archive Wizard] Failed to get status:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load archive wizard status',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: ArchiveWizardStatus
      resetRequestedAt?: boolean
      resetReminders?: boolean
    }

    if (!isArchiveWizardStatus(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status value' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {
      archive_request_status: body.status,
    }

    if (body.status === 'pending' || body.status === 'pending_extended') {
      patch.archive_requested_at = body.resetRequestedAt === false ? undefined : now
      patch.archive_reminder_count = 0
      patch.archive_last_reminder_at = null
    }

    if (body.resetReminders) {
      patch.archive_reminder_count = 0
      patch.archive_last_reminder_at = null
    }

    Object.keys(patch).forEach((key) => {
      if (patch[key] === undefined) {
        delete patch[key]
      }
    })

    const selectFields =
      'archive_request_status, archive_requested_at, archive_reminder_count, archive_last_reminder_at'

    let { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id)
      .select(selectFields)
      .maybeSingle<ProfileArchiveFields>()

    if (!updatedProfile && !updateError) {
      const displayName =
        (user.user_metadata?.display_name as string | undefined) ||
        (user.user_metadata?.full_name as string | undefined) ||
        user.email?.split('@')[0] ||
        'User'

      const upsertPayload = {
        id: user.id,
        display_name: displayName,
        ...patch,
      }

      const upsertResult = await supabase
        .from('profiles')
        .upsert(upsertPayload, { onConflict: 'id' })
        .select(selectFields)
        .maybeSingle<ProfileArchiveFields>()

      updatedProfile = upsertResult.data
      updateError = upsertResult.error
    }

    if (updateError && isMissingArchiveSchemaError(updateError)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Archive wizard schema is not applied yet. Run migration 008_add_archive_wizard_profile_fields.sql first.',
        },
        { status: 400 },
      )
    }

    if (updateError) {
      throw new Error(`Failed to update archive wizard status: ${updateError.message}`)
    }

    const response = await getArchiveStatusForUser(user.id)

    if (updatedProfile) {
      response.status = isArchiveWizardStatus(updatedProfile.archive_request_status)
        ? updatedProfile.archive_request_status
        : response.status
      response.archiveRequestedAt = updatedProfile.archive_requested_at ?? response.archiveRequestedAt
      response.archiveReminderCount = parseNumber(updatedProfile.archive_reminder_count)
      response.archiveLastReminderAt = updatedProfile.archive_last_reminder_at ?? response.archiveLastReminderAt
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Archive Wizard] Failed to update status:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update archive wizard status',
      },
      { status: 500 },
    )
  }
}
