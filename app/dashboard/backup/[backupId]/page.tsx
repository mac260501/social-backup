'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { BackupViewer } from '@/components/platforms/twitter/backup/BackupViewer'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { createClient } from '@/lib/supabase/client'

type BackupRecord = {
  id: string
  [key: string]: unknown
}

function getGuestDaysLeft(backup: BackupRecord | null): number | null {
  if (!backup || typeof backup !== 'object') return null
  const data = backup.data && typeof backup.data === 'object' && !Array.isArray(backup.data)
    ? (backup.data as Record<string, unknown>)
    : null
  if (!data) return null
  const retention = data.retention && typeof data.retention === 'object' && !Array.isArray(data.retention)
    ? (data.retention as Record<string, unknown>)
    : null
  if (!retention) return null
  if (retention.mode !== 'guest_30d') return null
  const expiresAtIso = typeof retention.expires_at === 'string' ? retention.expires_at : ''
  if (!expiresAtIso) return null
  const expiresAtMs = Date.parse(expiresAtIso)
  if (!Number.isFinite(expiresAtMs)) return null
  const remainingMs = expiresAtMs - Date.now()
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
}

export default function BackupDetailPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()
  const backupId = params.backupId as string

  const [backup, setBackup] = useState<BackupRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const fetchBackup = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const isShared = searchParams.get('shared') === '1'
      if (isShared) {
        const sharedResponse = await fetch(`/api/backups/shared?backupId=${backupId}`, { cache: 'no-store' })
        const sharedResult = (await sharedResponse.json()) as { success?: boolean; error?: string; backup?: BackupRecord }
        if (sharedResponse.ok && sharedResult.success && sharedResult.backup) {
          setBackup(sharedResult.backup)
          return
        }
      }

      const response = await fetch('/api/backups', { cache: 'no-store' })
      const result = (await response.json()) as { success?: boolean; error?: string; backups?: BackupRecord[] }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch backup')
      }

      const foundBackup = result.backups?.find((item) => item.id === backupId)
      if (!foundBackup) {
        throw new Error('Backup not found')
      }

      setBackup(foundBackup)
    } catch (err) {
      console.error('Error fetching backup:', err)
      setError(err instanceof Error ? err.message : 'Failed to load backup')
    } finally {
      setLoading(false)
    }
  }, [backupId, searchParams])

  useEffect(() => {
    void fetchBackup()
  }, [fetchBackup])

  useEffect(() => {
    const supabase = createClient()
    const loadAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setIsAuthenticated(Boolean(user))
    }
    void loadAuth()
  }, [])

  if (loading) {
    return <ThemeLoadingScreen label="Loading backup..." />
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="mb-4 text-5xl text-red-500">⚠️</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">Error Loading Backup</h2>
          <p className="mb-4 text-gray-600 dark:text-gray-400">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!backup) {
    return null
  }

  const guestDaysLeft = getGuestDaysLeft(backup)

  return (
    <>
      {!isAuthenticated && guestDaysLeft !== null && (
        <div className="fixed right-4 top-4 z-30 rounded-xl border border-amber-300/70 bg-amber-50/95 px-3 py-2 text-right shadow-sm dark:border-amber-500/40 dark:bg-amber-950/70">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            {guestDaysLeft} day{guestDaysLeft === 1 ? '' : 's'} before deletion
          </p>
          <a href="/signup" className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300">
            Sign up to keep this backup
          </a>
        </div>
      )}
      <BackupViewer backup={backup} />
    </>
  )
}
