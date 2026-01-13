'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function BackupsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [backups, setBackups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBackup, setSelectedBackup] = useState<any>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/')
    } else if (status === 'authenticated' && session?.user?.id) {
      fetchBackups()
    }
  }, [status, session, router])

  const fetchBackups = async () => {
    try {
      const response = await fetch(`/api/backups?userId=${encodeURIComponent(session?.user?.id || '')}`)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch backups')
      }

      setBackups(result.backups || [])
    } catch (error) {
      console.error('Error fetching backups:', error)
    } finally {
      setLoading(false)
    }
  }

  const downloadBackup = (backup: any) => {
    const dataStr = JSON.stringify(backup.data, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${backup.backup_type}_${new Date(backup.backed_up_at).toISOString().split('T')[0]}.json`
    link.click()
  }

  const deleteBackup = async (backupId: string, backupType: string) => {
    if (!confirm(`Are you sure you want to delete this ${backupType.replace('_', ' ')} backup? This action cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch(`/api/backups/delete?backupId=${encodeURIComponent(backupId)}`, {
        method: 'DELETE',
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete backup')
      }

      // Refresh the backups list
      fetchBackups()
    } catch (error) {
      console.error('Error deleting backup:', error)
      alert('Failed to delete backup. Please try again.')
    }
  }

  if (status === 'loading' || loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-semibold text-gray-900">Social Backup</h1>
              <div className="flex space-x-1">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="px-4 py-2 text-sm font-medium text-blue-600 border-b-2 border-blue-600"
                >
                  Backups
                </button>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Backups</h2>

        {backups.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No backups yet. Upload your Twitter archive to get started!</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Go to Dashboard
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {backups.map((backup) => (
              <div key={backup.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 capitalize">
                      {backup.backup_type.replace('_', ' ')}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Backed up on {new Date(backup.backed_up_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Items: <span className="font-semibold">{backup.data.count || 0}</span>
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedBackup(selectedBackup?.id === backup.id ? null : backup)}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      {selectedBackup?.id === backup.id ? 'Hide' : 'View'}
                    </button>
                    <button
                      onClick={() => downloadBackup(backup)}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => deleteBackup(backup.id, backup.backup_type)}
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {selectedBackup?.id === backup.id && (
                  <div className="mt-4 border-t pt-4">
                    <div className="bg-gray-50 rounded p-4 max-h-96 overflow-auto">
                      <pre className="text-xs text-gray-800">
                        {JSON.stringify(backup.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}