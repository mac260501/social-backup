import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const supabase = createAdminClient()

function isMissingArchiveSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) return false
  if (error.code === '42703') return true
  return (error.message || '').toLowerCase().includes('archive_request_')
}

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

    const now = new Date().toISOString()
    const patch = {
      archive_request_status: 'pending',
      archive_requested_at: now,
      archive_reminder_count: 0,
      archive_last_reminder_at: null,
    }

    let { error: updateError, data } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id)
      .select('id')
      .maybeSingle()

    if (!data && !updateError) {
      const displayName =
        (user.user_metadata?.display_name as string | undefined) ||
        (user.user_metadata?.full_name as string | undefined) ||
        user.email?.split('@')[0] ||
        'User'

      const upsertResult = await supabase
        .from('profiles')
        .upsert({ id: user.id, display_name: displayName, ...patch }, { onConflict: 'id' })
        .select('id')
        .maybeSingle()

      updateError = upsertResult.error
      data = upsertResult.data
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
      throw new Error(`Failed to save archive request status: ${updateError.message}`)
    }

    return NextResponse.json({
      success: true,
      status: 'pending',
      archiveRequestedAt: now,
      message: "Great! Twitter usually takes 24-48 hours to prepare your archive. We'll email you when it's time to download.",
    })
  } catch (error) {
    console.error('[Archive Wizard] Request step failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save archive request state',
      },
      { status: 500 },
    )
  }
}
