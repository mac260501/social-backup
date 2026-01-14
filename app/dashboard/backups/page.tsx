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
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

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
    link.download = `twitter_backup_${new Date(backup.uploaded_at || backup.created_at).toISOString().split('T')[0]}.json`
    link.click()
  }

  const toggleSection = (backupId: string, section: string) => {
    const key = `${backupId}-${section}`
    setExpandedSection(expandedSection === key ? null : key)
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
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {backup.backup_name || 'Twitter Archive Backup'}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Uploaded on {new Date(backup.uploaded_at || backup.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Size: <span className="font-semibold">{(backup.file_size / 1024 / 1024).toFixed(2)} MB</span>
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedBackup(selectedBackup?.id === backup.id ? null : backup)}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      {selectedBackup?.id === backup.id ? 'Collapse' : 'Expand'}
                    </button>
                    <button
                      onClick={() => downloadBackup(backup)}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => deleteBackup(backup.id, 'backup')}
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Stats Summary */}
                {backup.stats && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600">{backup.stats.tweets?.toLocaleString() || 0}</div>
                      <div className="text-xs text-gray-600 mt-1">Tweets</div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-purple-600">{backup.stats.followers?.toLocaleString() || 0}</div>
                      <div className="text-xs text-gray-600 mt-1">Followers</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">{backup.stats.following?.toLocaleString() || 0}</div>
                      <div className="text-xs text-gray-600 mt-1">Following</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-red-600">{backup.stats.likes?.toLocaleString() || 0}</div>
                      <div className="text-xs text-gray-600 mt-1">Likes</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-indigo-600">{backup.stats.dms?.toLocaleString() || 0}</div>
                      <div className="text-xs text-gray-600 mt-1">DMs</div>
                    </div>
                  </div>
                )}

                {/* Expandable Data Sections */}
                {selectedBackup?.id === backup.id && (
                  <div className="mt-4 border-t pt-4 space-y-2">
                    {/* Tweets Section */}
                    {backup.data?.tweets && backup.data.tweets.length > 0 && (
                      <div className="border rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'tweets')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50"
                        >
                          <span className="font-semibold text-gray-900">
                            Tweets ({backup.data.tweets.length})
                          </span>
                          <span className="text-gray-500">
                            {expandedSection === `${backup.id}-tweets` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-tweets` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 bg-gray-50 p-3 rounded">
                              {JSON.stringify(backup.data.tweets.slice(0, 10), null, 2)}
                              {backup.data.tweets.length > 10 && `\n\n... and ${backup.data.tweets.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Followers Section */}
                    {backup.data?.followers && backup.data.followers.length > 0 && (
                      <div className="border rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'followers')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50"
                        >
                          <span className="font-semibold text-gray-900">
                            Followers ({backup.data.followers.length})
                          </span>
                          <span className="text-gray-500">
                            {expandedSection === `${backup.id}-followers` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-followers` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 bg-gray-50 p-3 rounded">
                              {JSON.stringify(backup.data.followers.slice(0, 10), null, 2)}
                              {backup.data.followers.length > 10 && `\n\n... and ${backup.data.followers.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Following Section */}
                    {backup.data?.following && backup.data.following.length > 0 && (
                      <div className="border rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'following')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50"
                        >
                          <span className="font-semibold text-gray-900">
                            Following ({backup.data.following.length})
                          </span>
                          <span className="text-gray-500">
                            {expandedSection === `${backup.id}-following` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-following` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 bg-gray-50 p-3 rounded">
                              {JSON.stringify(backup.data.following.slice(0, 10), null, 2)}
                              {backup.data.following.length > 10 && `\n\n... and ${backup.data.following.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Likes Section */}
                    {backup.data?.likes && backup.data.likes.length > 0 && (
                      <div className="border rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'likes')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50"
                        >
                          <span className="font-semibold text-gray-900">
                            Likes ({backup.data.likes.length})
                          </span>
                          <span className="text-gray-500">
                            {expandedSection === `${backup.id}-likes` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-likes` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 bg-gray-50 p-3 rounded">
                              {JSON.stringify(backup.data.likes.slice(0, 10), null, 2)}
                              {backup.data.likes.length > 10 && `\n\n... and ${backup.data.likes.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Direct Messages Section */}
                    {backup.data?.direct_messages && backup.data.direct_messages.length > 0 && (
                      <div className="border rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'dms')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50"
                        >
                          <span className="font-semibold text-gray-900">
                            Direct Messages ({backup.data.direct_messages.length} conversations)
                          </span>
                          <span className="text-gray-500">
                            {expandedSection === `${backup.id}-dms` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-dms` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 bg-gray-50 p-3 rounded">
                              {JSON.stringify(backup.data.direct_messages.slice(0, 5), null, 2)}
                              {backup.data.direct_messages.length > 5 && `\n\n... and ${backup.data.direct_messages.length - 5} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
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