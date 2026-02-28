import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const supabase = createAdminClient()

type FeedbackRating = 'helpful' | 'not_helpful'

function normalizeString(value: unknown, maxLength = 1024): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function normalizeSessionId(value: unknown): string | null {
  const normalized = normalizeString(value, 128)
  return normalized.length > 0 ? normalized : null
}

function toRating(value: unknown): FeedbackRating | null {
  if (value === 'helpful' || value === 'not_helpful') return value
  return null
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      feedbackId?: unknown
      rating?: unknown
      comment?: unknown
      sessionId?: unknown
    }

    const feedbackId = normalizeString(body.feedbackId, 64)
    const rating = toRating(body.rating)
    const sessionId = normalizeSessionId(body.sessionId)
    const comment = normalizeString(body.comment, 2000)

    if (!feedbackId || !rating) {
      return NextResponse.json({ error: 'feedbackId and rating are required' }, { status: 400 })
    }

    let query = supabase
      .from('scanner_feedback')
      .update({
        user_rating: rating,
        user_comment: comment || null,
      })
      .eq('id', feedbackId)
      .select('id')

    if (sessionId) {
      query = query.eq('session_id', sessionId)
    }

    const { data, error } = await query
    if (error) {
      console.error('[Scanner Feedback] Failed to update row:', error)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Feedback record not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Scanner Feedback] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save feedback',
      },
      { status: 500 },
    )
  }
}
