'use client'

import { FormEvent, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, Shield, Text, ThumbsDown, ThumbsUp, Wand2 } from 'lucide-react'

type RiskLevel = 'safe' | 'caution' | 'risky' | 'likely_flagged'

type AnalysisFlag = {
  issue?: string
  why?: string
  severity?: number
  suggestion?: string
}

type TweetAnalysisResult = {
  riskScore?: number
  riskLevel?: RiskLevel
  summary?: string
  flags?: AnalysisFlag[]
  rewriteSuggestion?: string
  contextNotes?: string
  feedbackId?: string
}

const MAX_TWEET_LENGTH = 280
const SCANNER_SESSION_STORAGE_KEY = 'scanner_session_id'
type FeedbackRating = 'helpful' | 'not_helpful'

function normalizeRiskScore(score: unknown) {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getRiskPillClass(level?: RiskLevel) {
  switch (level) {
    case 'safe':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300'
    case 'caution':
      return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300'
    case 'risky':
      return 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/35 dark:bg-orange-500/10 dark:text-orange-300'
    case 'likely_flagged':
      return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300'
    default:
      return 'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-white/20 dark:bg-white/10 dark:text-neutral-200'
  }
}

function getRiskGaugeClass(level?: RiskLevel) {
  switch (level) {
    case 'safe':
      return 'text-emerald-500 dark:text-emerald-300'
    case 'caution':
      return 'text-amber-500 dark:text-amber-300'
    case 'risky':
      return 'text-orange-500 dark:text-orange-300'
    case 'likely_flagged':
      return 'text-rose-500 dark:text-rose-300'
    default:
      return 'text-blue-500 dark:text-blue-300'
  }
}

function formatRiskLevel(level?: RiskLevel) {
  if (!level) return 'Awaiting scan'
  return level.replace('_', ' ')
}

function defaultSummary(level?: RiskLevel) {
  if (!level) return 'Run a scan to get risk analysis before you post.'
  if (level === 'safe') return 'This draft appears low risk under current moderation patterns.'
  if (level === 'caution') return 'This draft is mostly okay but could be interpreted negatively in some contexts.'
  if (level === 'risky') return 'This draft has elevated moderation risk and should be reworded before posting.'
  return 'This draft is likely to trigger enforcement signals and should be rewritten.'
}

function RiskGauge({ score, level }: { score: number; level?: RiskLevel }) {
  const radius = 52
  const arcLength = Math.PI * radius
  const progressLength = (score / 100) * arcLength

  return (
    <div className="relative mx-auto w-full max-w-[210px]">
      <svg viewBox="0 0 130 82" className="h-auto w-full">
        <path
          d="M13 69 A52 52 0 0 1 117 69"
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
          className="text-neutral-200 dark:text-white/15"
        />
        <path
          d="M13 69 A52 52 0 0 1 117 69"
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
          className={`${getRiskGaugeClass(level)} transition-[stroke-dasharray] duration-500`}
          style={{ strokeDasharray: `${progressLength} ${arcLength}` }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-12 text-center">
        <p className={`text-4xl font-bold tracking-tight ${getRiskGaugeClass(level)}`}>{score}</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">Risk score</p>
      </div>
    </div>
  )
}

function getOrCreateScannerSessionId(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const existing = window.localStorage.getItem(SCANNER_SESSION_STORAGE_KEY)
    if (existing && existing.trim()) return existing

    const generated =
      typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.localStorage.setItem(SCANNER_SESSION_STORAGE_KEY, generated)
    return generated
  } catch {
    return typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function FeedbackBar({ feedbackId }: { feedbackId: string }) {
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitFeedback(rating: FeedbackRating) {
    setIsSubmitting(true)
    setError(null)

    try {
      const sessionId = getOrCreateScannerSessionId()
      const response = await fetch('/api/scanner/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackId,
          rating,
          comment: rating === 'not_helpful' ? comment : '',
          sessionId,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Failed to save feedback')

      setSubmitted(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save feedback')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300">
        Thanks for the feedback.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-neutral-200/80 bg-white/65 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Was this analysis helpful?</p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void submitFeedback('helpful')
          }}
          disabled={isSubmitting}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-white/[0.04] dark:text-neutral-200 dark:hover:bg-white/10"
        >
          <ThumbsUp size={13} />
          Helpful
        </button>
        <button
          type="button"
          onClick={() => setShowComment(true)}
          disabled={isSubmitting}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-white/[0.04] dark:text-neutral-200 dark:hover:bg-white/10"
        >
          <ThumbsDown size={13} />
          Not helpful
        </button>
      </div>

      {showComment && (
        <div className="mt-3 space-y-2">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What felt off? (optional)"
            rows={3}
            maxLength={1000}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-blue-400"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void submitFeedback('not_helpful')
              }}
              disabled={isSubmitting}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {isSubmitting ? 'Submitting...' : 'Submit feedback'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowComment(false)
                setComment('')
              }}
              disabled={isSubmitting}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  )
}

export function TweetAnalyzerPanel() {
  const [tweetText, setTweetText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TweetAnalysisResult | null>(null)

  const characterCount = tweetText.length
  const canSubmit = useMemo(() => tweetText.trim().length > 0 && !isSubmitting, [tweetText, isSubmitting])
  const riskScore = normalizeRiskScore(result?.riskScore)
  const riskLevel = result?.riskLevel
  const flags = useMemo(() => (Array.isArray(result?.flags) ? result.flags : []), [result?.flags])
  const summary = result?.summary?.trim() || defaultSummary(riskLevel)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setIsSubmitting(true)
    setError(null)

    try {
      const sessionId = getOrCreateScannerSessionId()
      const response = await fetch('/api/scanner/tweet-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: tweetText, sessionId }),
      })

      const data = (await response.json().catch(() => ({}))) as TweetAnalysisResult & { error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze tweet')
      }

      setResult(data)
    } catch (submitError) {
      setResult(null)
      setError(submitError instanceof Error ? submitError.message : 'Failed to analyze tweet')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">Scan mode</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-4xl">Tweet Scanner</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-600 dark:text-neutral-300 sm:text-base">
          Paste a draft tweet and get a risk check before you post.
        </p>
      </header>

      <div className="mt-9 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:gap-5">
        <form
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          className="self-start rounded-[22px] border border-neutral-300/90 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.08)] dark:border-neutral-700 dark:bg-neutral-900/88"
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-[11px] font-bold uppercase text-white">
                SB
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">Draft tweet</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">@youraccount</p>
              </div>
            </div>
            <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 dark:border-white/15 dark:bg-white/10 dark:text-neutral-200">
              Text only
            </span>
          </div>

          <div className="border-y border-neutral-200/90 px-4 py-3 dark:border-white/10 sm:px-5 sm:py-4">
            <label htmlFor="tweet-draft" className="sr-only">
              Draft tweet
            </label>
            <textarea
              id="tweet-draft"
              value={tweetText}
              onChange={(event) => setTweetText(event.target.value)}
              placeholder="What's happening?"
              maxLength={MAX_TWEET_LENGTH}
              rows={6}
              className="min-h-[180px] w-full resize-none border-0 bg-transparent text-[21px] leading-8 text-neutral-900 outline-none placeholder:text-neutral-400 sm:min-h-[220px] sm:text-[24px] dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
              <Text size={13} />
              <span>Tweet scan only (v0)</span>
            </div>
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {characterCount} / {MAX_TWEET_LENGTH}
              </p>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex w-[10.5rem] items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300 dark:bg-blue-500 dark:hover:bg-blue-400 dark:disabled:bg-blue-900/60"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                {isSubmitting ? 'Scanning...' : 'Scan Tweet'}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 pb-3 sm:px-5">
              <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300">
                {error}
              </p>
            </div>
          )}
        </form>

        <div className="space-y-4">
          <article className="rounded-2xl border border-neutral-300 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)] dark:border-neutral-700 dark:bg-neutral-900/85 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="h-6 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400" aria-hidden="true" />
              <p className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-white">Risk Assessment</p>
            </div>
            <div className="mt-4">
              <RiskGauge score={riskScore} level={riskLevel} />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getRiskPillClass(riskLevel)}`}>
                {formatRiskLevel(riskLevel)}
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-300">Summary</p>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">{summary}</p>
            </div>

            {result?.contextNotes && (
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white/80 p-3 dark:border-white/10 dark:bg-neutral-950/50">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">Context notes</p>
                <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-200">{result.contextNotes}</p>
              </div>
            )}
          </article>

          {result?.feedbackId && <FeedbackBar key={result.feedbackId} feedbackId={result.feedbackId} />}

          <article className="rounded-2xl border border-neutral-300 bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.08)] dark:border-neutral-700 dark:bg-neutral-900/85 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="h-6 w-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400" aria-hidden="true" />
              <p className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-white">Suggestions</p>
            </div>

            {flags.length > 0 ? (
              <div className="mt-4 space-y-2.5">
                {flags.map((flag, index) => (
                  <div
                    key={`${flag.issue || 'flag'}-${index}`}
                    className="rounded-xl border border-neutral-200 bg-white/80 p-3 dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                        <AlertTriangle size={14} className="mr-1 inline-flex align-[-2px] text-cyan-500 dark:text-cyan-300" />
                        {flag.issue || 'Potential issue'}
                      </p>
                      {typeof flag.severity === 'number' && (
                        <span className="rounded-md border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:border-white/15 dark:bg-white/10 dark:text-neutral-200">
                          Sev {Math.max(1, Math.min(5, Math.round(flag.severity)))}
                        </span>
                      )}
                    </div>
                    {flag.why && <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{flag.why}</p>}
                    {flag.suggestion && (
                      <p className="mt-1 text-xs text-neutral-800 dark:text-neutral-100">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-300">Suggestion:</span> {flag.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 size={14} className="mr-1 inline-flex align-[-2px]" />
                No specific flags returned.
              </div>
            )}

            {result?.rewriteSuggestion && (
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white/80 p-3 dark:border-white/10 dark:bg-neutral-950/50">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-600 dark:text-cyan-300">
                  <Wand2 size={12} className="mr-1 inline-flex align-[-1px]" />
                  Suggested rewrite
                </p>
                <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-100">{result.rewriteSuggestion}</p>
              </div>
            )}

            {!result && (
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white/80 p-3 dark:border-white/10 dark:bg-neutral-950/50">
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  <Info size={12} className="mr-1 inline-flex align-[-1px]" />
                  Scan your draft to see issue-specific suggestions and safer rewrites.
                </p>
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  )
}
