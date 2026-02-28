import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { TWEET_ANALYZER_PROMPT } from '@/lib/prompts/tweet-analyzer'
import { createAdminClient } from '@/lib/supabase/admin'

const supabase = createAdminClient()

function extractTextBlocks(content: Anthropic.Messages.Message['content']) {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed

  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Try extracting the first JSON object from mixed text.
  }

  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null

  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }

  return null
}

function getAnthropicClient() {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY is not configured')
  }
  return new Anthropic({ apiKey })
}

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 128)
}

function readRiskScore(payload: Record<string, unknown>): number | null {
  const value = payload.riskScore
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.round(value)
  if (normalized < 0 || normalized > 100) return null
  return normalized
}

function readRiskLevel(payload: Record<string, unknown>): string | null {
  const value = payload.riskLevel
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, 64)
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { text?: unknown; sessionId?: unknown }
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const sessionId = normalizeSessionId(body.sessionId)

    if (!text) {
      return NextResponse.json({ error: 'Tweet text is required' }, { status: 400 })
    }

    if (text.length > 280) {
      return NextResponse.json({ error: 'Tweet must be 280 characters or fewer for v0' }, { status: 400 })
    }

    const anthropic = getAnthropicClient()
    const analysis = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      temperature: 0.2,
      system: TWEET_ANALYZER_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analyze this draft tweet:\n\n"${text}"`,
        },
      ],
    })

    const responseText = extractTextBlocks(analysis.content)
    const parsed = extractJsonObject(responseText)
    if (!parsed) {
      return NextResponse.json(
        { error: 'Failed to parse model response as JSON', raw: responseText },
        { status: 502 },
      )
    }

    const { data: feedback, error: feedbackError } = await supabase
      .from('scanner_feedback')
      .insert({
        tweet_text: text,
        analysis_result: parsed,
        risk_score: readRiskScore(parsed),
        risk_level: readRiskLevel(parsed),
        session_id: sessionId,
      })
      .select('id')
      .single()

    if (feedbackError || !feedback?.id) {
      console.error('[Tweet Check] Failed to store analysis row:', feedbackError)
      return NextResponse.json({ error: 'Failed to persist analysis feedback context' }, { status: 500 })
    }

    return NextResponse.json({
      ...parsed,
      feedbackId: feedback.id,
    })
  } catch (error) {
    console.error('[Tweet Check] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to analyze tweet',
      },
      { status: 500 },
    )
  }
}
