'use client'

import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BackupViewer } from '@/components/BackupViewer'
import { Spinner } from '@/components/SkeletonLoader'
import { createClient } from '@/lib/supabase/client'

export default function BackupDetailPage() {
  const router = useRouter()
  const supabase = createClient()
  const params = useParams()
  const backupId = params.backupId as string

  const [backup, setBackup] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/')
      } else {
        fetchBackup()
      }
    })
  }, [backupId])

  const fetchBackup = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/backups')
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch backup')
      }

      const foundBackup = result.backups?.find((b: any) => b.id === backupId)

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
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading backup...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Error Loading Backup</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard/backups')}
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
