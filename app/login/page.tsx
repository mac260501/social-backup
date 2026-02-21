'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SocialLogoRow } from '@/components/social-logos'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [showResendConfirmation, setShowResendConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const handleAuthState = async () => {
      const {
        data: { user: existingUser },
      } = await supabase.auth.getUser()

      if (existingUser) {
        router.replace('/dashboard')
        return
      }

      const code = searchParams.get('code')
      if (!code) return

      setLoading(true)
      setError(null)

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

      if (exchangeError) {
        const {
          data: { user: postExchangeUser },
        } = await supabase.auth.getUser()

        if (postExchangeUser) {
          router.replace('/dashboard')
          router.refresh()
          return
        }

        setError(exchangeError.message)
        setLoading(false)
        return
      }

      router.replace('/dashboard')
      router.refresh()
    }

    handleAuthState()
  }, [router, searchParams, supabase])

  const handleEmailLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    setShowResendConfirmation(false)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        setError('Email not confirmed. Check your inbox or disable email confirmation in Supabase Auth settings.')
        setShowResendConfirmation(true)
      } else {
        setError(signInError.message)
      }
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  const handleGoogleLogin = async () => {
    setError(null)
    setInfo(null)
    setShowResendConfirmation(false)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/login`,
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

  const handleResendConfirmation = async () => {
    setError(null)
    setInfo(null)

    if (!email) {
      setError('Enter your email first, then resend confirmation.')
      return
    }

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
    })

    if (resendError) {
      setError(resendError.message)
      return
    }

    setInfo('Confirmation email sent. Check inbox/spam.')
  }

  const authFailed = searchParams.get('error') === 'auth_failed'

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-gray-950 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.24),transparent_50%)] dark:bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.18),transparent_55%)]" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">Social Backup</p>
        <SocialLogoRow />

        <h1 className="pb-2 text-4xl font-extrabold leading-[1.12] tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          Welcome{' '}
          <span className="bg-gradient-to-r from-[#1d9bf0] via-[#d62976] to-[#25F4EE] bg-clip-text text-transparent">
            back
          </span>
          .
        </h1>

        <div className="mt-6 w-full max-w-md space-y-4 rounded-3xl border border-gray-200/70 bg-white/85 p-5 text-left shadow-xl backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <form onSubmit={handleEmailLogin} className="space-y-3">
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
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-6 py-3 font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Login'}
            </button>
          </form>

          <button
            onClick={handleGoogleLogin}
            className="w-full rounded-full border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-900 transition hover:bg-gray-100 dark:border-white/20 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Continue with Google
          </button>

          {(authFailed || error) && (
            <p className="text-sm text-red-600 dark:text-red-400">{error || 'Authentication failed. Please try again.'}</p>
          )}
          {info && <p className="text-sm text-green-700 dark:text-green-400">{info}</p>}

          {showResendConfirmation && (
            <button
              type="button"
              onClick={handleResendConfirmation}
              className="w-full text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              Resend confirmation email
            </button>
          )}

          <p className="text-sm text-center text-gray-600 dark:text-gray-300">
            New here?{' '}
            <Link href="/signup" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
              Create an account
            </Link>
          </p>

          <Link href="/" className="block w-full text-center text-sm text-gray-600 hover:underline dark:text-gray-300">
            Back to Home
          </Link>
        </div>
      </section>
    </main>
  )
}
