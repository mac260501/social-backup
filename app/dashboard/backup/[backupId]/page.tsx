'use client'

import { useRouter, useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { BackupViewer } from '@/components/platforms/twitter/backup/BackupViewer'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { createClient } from '@/lib/supabase/client'

type BackupRecord = {
  id: string
  [key: string]: unknown
}

export default function BackupDetailPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const params = useParams()
  const backupId = params.backupId as string

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [backup, setBackup] = useState<BackupRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBackup = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/backups')
      const result = (await response.json()) as { success?: boolean; error?: string; backups?: BackupRecord[] }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch backup')
      }

      const foundBackup = result.backups?.find((b) => b.id === backupId)

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
  }, [backupId])

  useEffect(() => {
    const init = async () => {
      const {
        data: { user: currentUser }
      } = await supabase.auth.getUser()

      if (!currentUser) {
        router.push('/login')
        return
      }

      setUser(currentUser)
      await fetchBackup()
      setAuthLoading(false)
    }

    init()
  }, [router, supabase, fetchBackup])

  if (authLoading || loading) {
    return <ThemeLoadingScreen label="Loading backup..." />
  }

  if (!user) {
    return null
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Error Loading Backup</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard?tab=all-backups')}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Back to Backups
          </button>
        </div>
      </div>
    )
  }

  if (!backup) {
    return null
  }

  return <BackupViewer backup={backup} />
}
