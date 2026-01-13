'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (session) {
      router.push('/dashboard')
    }
  }, [session, router])

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Social Backup
          </h1>
          <p className="text-gray-600">
            Never lose your tweets, followers, or content again
          </p>
        </div>

        <div className="mt-8">
          <button
            onClick={() => signIn('twitter')}
            className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-500 hover:bg-blue-600 transition"
          >
            Sign in with X
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>✓ Automatic daily backups</p>
          <p>✓ Download all your data anytime</p>
          <p>✓ Free to start</p>
        </div>
      </div>
    </div>
  )
}