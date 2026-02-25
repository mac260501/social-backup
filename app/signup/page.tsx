'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SocialLogoRow } from '@/components/social-logos'

export default function SignupPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [showResendConfirmation, setShowResendConfirmation] = useState(false)
  const [resendingConfirmation, setResendingConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const notifyNewSignup = async (params: { userId: string; email: string; fullName?: string }) => {
    try {
      await fetch('/api/notifications/new-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        keepalive: true,
      })
    } catch {
      // Keep signup UX clean even if notification delivery fails.
    }
  }

  const claimAnonymousBackups = async () => {
    try {
      await fetch('/api/backups/claim', {
        method: 'POST',
        keepalive: true,
      })
    } catch {
      // Do not block account creation flow if claim fails.
    }
  }

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    setShowResendConfirmation(false)

    if (!fullName.trim()) {
      setError('Name is required')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          display_name: fullName.trim(),
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      if (signUpError.message.toLowerCase().includes('email not confirmed')) {
        setShowResendConfirmation(true)
      }
      setLoading(false)
      return
    }

    if (data.user?.id && data.user.email) {
      void notifyNewSignup({
        userId: data.user.id,
        email: data.user.email,
        fullName: fullName.trim(),
      })
    }

    if (!data.session) {
      setInfo('Account created. Email confirmation is required before login.')
      setShowResendConfirmation(true)
      setLoading(false)
      return
    }

    await claimAnonymousBackups()
    router.push('/dashboard')
    router.refresh()
  }

  const handleResendConfirmation = async () => {
    setError(null)
    setInfo(null)

    if (!email.trim()) {
      setError('Enter your email first, then resend confirmation.')
      return
    }

    setResendingConfirmation(true)
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    })
    setResendingConfirmation(false)

    if (resendError) {
      setError(resendError.message)
      return
    }

    setInfo('Confirmation email sent. Check inbox/spam.')
  }

  const handleGoogleSignup = async () => {
    setError(null)
    setInfo(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    })
    if (oauthError) {
      if (oauthError.message.toLowerCase().includes('unsupported provider')) {
        setError('Google provider is not enabled for this Supabase project.')
      } else {
        setError(oauthError.message)
      }
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-gray-950 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.24),transparent_50%)] dark:bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.18),transparent_55%)]" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">Social Backup</p>
        <SocialLogoRow />

        <h1 className="pb-2 text-4xl font-extrabold leading-[1.12] tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          Create your{' '}
          <span className="bg-gradient-to-r from-[#1d9bf0] via-[#d62976] to-[#25F4EE] bg-clip-text text-transparent">
            account
          </span>
          .
        </h1>

        <div className="mt-6 w-full max-w-md space-y-4 rounded-3xl border border-gray-200/70 bg-white/85 p-5 text-left shadow-xl backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <form onSubmit={handleSignup} className="space-y-3">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              required
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-white/20 dark:bg-black/40 dark:text-white"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-white/20 dark:bg-black/40 dark:text-white"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-white/20 dark:bg-black/40 dark:text-white"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              required
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-white/20 dark:bg-black/40 dark:text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-6 py-3 font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Sign Up'}
            </button>
          </form>

          <button
            onClick={handleGoogleSignup}
            className="w-full rounded-full border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-900 transition hover:bg-gray-100 dark:border-white/20 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Sign up with Google
          </button>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {info && <p className="text-sm text-green-700 dark:text-green-400">{info}</p>}
          {showResendConfirmation && (
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={resendingConfirmation}
              className="w-full text-sm text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400"
            >
              {resendingConfirmation ? 'Sending confirmation...' : 'Resend confirmation email'}
            </button>
          )}

          <p className="text-sm text-center text-gray-600 dark:text-gray-300">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  )
}
