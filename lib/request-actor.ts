import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const SESSION_COOKIE_NAME = 'sb_session_id'

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidSessionId(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value))
}

export function createSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  }
}

export function setActorSessionCookie(response: NextResponse, actorId: string) {
  response.cookies.set(SESSION_COOKIE_NAME, actorId, createSessionCookieOptions())
}

export async function getRequestActorId(): Promise<string | null> {
  const authClient = await createServerClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (user?.id) return user.id

  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value || null
  if (isValidSessionId(sessionId)) return sessionId

  return null
}

export async function ensureActorProfileExists(
  supabase: SupabaseClient,
  actorId: string,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: actorId,
        display_name: 'Guest',
      },
      { onConflict: 'id' },
    )

  if (error) {
    throw new Error(`Failed to ensure actor profile: ${error.message}`)
  }
}

function shouldFallbackToGuest(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = String((error as { code?: unknown }).code || '')
  const message = String((error as { message?: unknown }).message || '').toLowerCase()
  return code === '23503' || message.includes('profiles_id_fkey')
}

function formatSupabaseError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown error'
  const details = error as { message?: unknown; status?: unknown; code?: unknown; name?: unknown }
  const message = typeof details.message === 'string' ? details.message : 'Unknown error'
  const status = details.status !== undefined ? ` status=${String(details.status)}` : ''
  const code = details.code !== undefined ? ` code=${String(details.code)}` : ''
  const name = details.name !== undefined ? ` name=${String(details.name)}` : ''
  return `${message}${status}${code}${name}`
}

async function createGuestAuthUser(supabase: SupabaseClient): Promise<string> {
  const maxAttempts = 3
  let lastErrorMessage = 'Unknown error'

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const generatedToken = crypto.randomUUID().replaceAll('-', '')
    const email = `guest-${generatedToken}@example.com`
    // Keep password under bcrypt's 72-byte limit to avoid Auth 500 failures.
    const password = `Guest-${crypto.randomUUID()}`

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        is_guest: true,
        source: 'anonymous_mvp',
      },
    })

    if (!error && data.user?.id) {
      return data.user.id
    }

    lastErrorMessage = formatSupabaseError(error)
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
  }

  throw new Error(`Failed to create guest actor: ${lastErrorMessage}`)
}

export async function resolveActorForWrite(
  supabase: SupabaseClient,
  actorId: string | null,
): Promise<{ actorId: string; shouldSetCookie: boolean }> {
  if (actorId) {
    try {
      await ensureActorProfileExists(supabase, actorId)
      return { actorId, shouldSetCookie: false }
    } catch (error) {
      if (!shouldFallbackToGuest(error)) {
        throw error
      }
    }
  }

  try {
    const guestActorId = await createGuestAuthUser(supabase)
    await ensureActorProfileExists(supabase, guestActorId)
    return { actorId: guestActorId, shouldSetCookie: true }
  } catch (guestError) {
    const guestMessage = guestError instanceof Error ? guestError.message : 'Unknown error'
    throw new Error(
      `Unable to resolve actor identity. ${guestMessage}. ` +
      'Check Supabase Auth hooks/triggers for user creation failures.',
    )
  }
}
