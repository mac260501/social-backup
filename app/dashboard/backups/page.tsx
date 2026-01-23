'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'

export default function BackupsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [backups, setBackups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBackup, setSelectedBackup] = useState<any>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [mediaFiles, setMediaFiles] = useState<{ [key: string]: any[] }>({})
  const [loadingMedia, setLoadingMedia] = useState<{ [key: string]: boolean }>({})

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

  const fetchMediaFiles = async (backupId: string) => {
    if (mediaFiles[backupId] || loadingMedia[backupId]) {
      return // Already loaded or loading
    }

    setLoadingMedia({ ...loadingMedia, [backupId]: true })

    try {
      const response = await fetch(`/api/media?backupId=${encodeURIComponent(backupId)}`)
      const result = await response.json()

      if (result.success) {
        setMediaFiles({ ...mediaFiles, [backupId]: result.mediaFiles || [] })
      }
    } catch (error) {
      console.error('Error fetching media files:', error)
      setMediaFiles({ ...mediaFiles, [backupId]: [] })
    } finally {
      setLoadingMedia({ ...loadingMedia, [backupId]: false })
    }
  }

  const toggleSection = (backupId: string, section: string) => {
    const key = `${backupId}-${section}`
    const newExpandedSection = expandedSection === key ? null : key
    setExpandedSection(newExpandedSection)

    // Fetch media files when media section is expanded
    if (section === 'media' && newExpandedSection === key) {
      fetchMediaFiles(backupId)
    }
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
    return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center text-gray-900 dark:text-white">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-4 sm:space-x-8">
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Social Backup</h1>
              <div className="hidden sm:flex space-x-1">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="px-3 sm:px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                >
                  Backups
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-3">
              <ThemeToggle />
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <div className="sm:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex-1 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border-b-2 border-transparent"
          >
            Dashboard
          </button>
          <button
            onClick={() => router.push('/dashboard/backups')}
            className="flex-1 px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
          >
            Backups
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-6">Your Backups</h2>

        {backups.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg dark:shadow-gray-900/50 p-6 sm:p-8 text-center">
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">No backups yet. Upload your Twitter archive to get started!</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="mt-4 px-4 sm:px-6 py-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 text-sm sm:text-base"
            >
              Go to Dashboard
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {backups.map((backup) => (
              <div key={backup.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg dark:shadow-gray-900/50 p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                  <div className="flex-1">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                      {backup.backup_name || 'Twitter Archive Backup'}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Uploaded on {new Date(backup.uploaded_at || backup.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Size: <span className="font-semibold">{(backup.file_size / 1024 / 1024).toFixed(2)} MB</span>
                    </p>
                  </div>
                  <div className="flex flex-row sm:flex-row gap-2 w-full sm:w-auto">
                    <button
                      onClick={() => setSelectedBackup(selectedBackup?.id === backup.id ? null : backup)}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-xs sm:text-sm"
                    >
                      {selectedBackup?.id === backup.id ? 'Collapse' : 'Expand'}
                    </button>
                    <button
                      onClick={() => downloadBackup(backup)}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 text-xs sm:text-sm"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => deleteBackup(backup.id, 'backup')}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-red-500 dark:bg-red-600 text-white rounded-lg hover:bg-red-600 dark:hover:bg-red-700 text-xs sm:text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Stats Summary */}
                {backup.stats && (
                  <>
                    {backup.backup_source === 'archive_upload' ? (
                      /* Archive backups: Show all 6 stats */
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">{backup.stats.tweets?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Tweets</div>
                        </div>
                        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-orange-600 dark:text-orange-400">{backup.stats.media_files?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Media</div>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-purple-600 dark:text-purple-400">{backup.stats.followers?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Followers</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">{backup.stats.following?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Following</div>
                        </div>
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">{backup.stats.likes?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Likes</div>
                        </div>
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400">{backup.stats.dms?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">DMs</div>
                        </div>
                      </div>
                    ) : (
                      /* Scraped backups: Show only 4 stats (tweets, media, followers, following) */
                      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">{backup.stats.tweets?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Tweets</div>
                        </div>
                        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-orange-600 dark:text-orange-400">{backup.stats.media_files?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Media</div>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-purple-600 dark:text-purple-400">{backup.stats.followers?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Followers</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 sm:p-3 text-center">
                          <div className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">{backup.stats.following?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Following</div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Expandable Data Sections */}
                {selectedBackup?.id === backup.id && (
                  <div className="mt-4 border-t dark:border-gray-700 pt-4 space-y-2">
                    {/* Tweets Section */}
                    {backup.data?.tweets && backup.data.tweets.length > 0 && (
                      <div className="border dark:border-gray-700 rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'tweets')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Tweets ({backup.data.tweets.length})
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {expandedSection === `${backup.id}-tweets` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-tweets` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded whitespace-pre-wrap break-words overflow-x-hidden">
                              {JSON.stringify(backup.data.tweets.slice(0, 10), null, 2)}
                              {backup.data.tweets.length > 10 && `\n\n... and ${backup.data.tweets.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Media Section */}
                    {backup.stats?.media_files && backup.stats.media_files > 0 && (
                      <div className="border dark:border-gray-700 rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'media')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Media Files ({backup.stats.media_files})
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {expandedSection === `${backup.id}-media` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-media` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            {loadingMedia[backup.id] ? (
                              <div className="text-center py-4 text-gray-600 dark:text-gray-400">
                                Loading media files...
                              </div>
                            ) : mediaFiles[backup.id] && mediaFiles[backup.id].length > 0 ? (
                              <div className="space-y-2">
                                {mediaFiles[backup.id].slice(0, 15).map((media: any, index: number) => (
                                  <div key={index} className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-gray-900 dark:text-white truncate">
                                          {media.file_name}
                                        </div>
                                        <div className="text-gray-600 dark:text-gray-400 mt-1">
                                          Type: <span className="text-orange-600 dark:text-orange-400">{media.media_type}</span>
                                          {' • '}
                                          Size: {(media.file_size / 1024).toFixed(1)} KB
                                          {' • '}
                                          {media.mime_type}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {mediaFiles[backup.id].length > 15 && (
                                  <div className="text-center text-gray-500 dark:text-gray-400 text-xs py-2">
                                    ... and {mediaFiles[backup.id].length - 15} more media files
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-600 dark:text-gray-400">
                                No media files found
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Followers Section */}
                    {backup.data?.followers && Array.isArray(backup.data.followers) && backup.data.followers.length > 0 && backup.data.followers.some((f: any) => f && (f.username || f.user_id)) && (
                      <div className="border dark:border-gray-700 rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'followers')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Followers ({backup.data.followers.length})
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {expandedSection === `${backup.id}-followers` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-followers` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded whitespace-pre-wrap break-words overflow-x-hidden">
                              {JSON.stringify(backup.data.followers.slice(0, 10), null, 2)}
                              {backup.data.followers.length > 10 && `\n\n... and ${backup.data.followers.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Following Section */}
                    {backup.data?.following && Array.isArray(backup.data.following) && backup.data.following.length > 0 && backup.data.following.some((f: any) => f && (f.username || f.user_id)) && (
                      <div className="border dark:border-gray-700 rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'following')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Following ({backup.data.following.length})
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {expandedSection === `${backup.id}-following` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-following` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded whitespace-pre-wrap break-words overflow-x-hidden">
                              {JSON.stringify(backup.data.following.slice(0, 10), null, 2)}
                              {backup.data.following.length > 10 && `\n\n... and ${backup.data.following.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Likes Section */}
                    {backup.data?.likes && backup.data.likes.length > 0 && (
                      <div className="border dark:border-gray-700 rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'likes')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Likes ({backup.data.likes.length})
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {expandedSection === `${backup.id}-likes` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-likes` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded whitespace-pre-wrap break-words overflow-x-hidden">
                              {JSON.stringify(backup.data.likes.slice(0, 10), null, 2)}
                              {backup.data.likes.length > 10 && `\n\n... and ${backup.data.likes.length - 10} more`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Direct Messages Section */}
                    {backup.data?.direct_messages && backup.data.direct_messages.length > 0 && (
                      <div className="border dark:border-gray-700 rounded-lg">
                        <button
                          onClick={() => toggleSection(backup.id, 'dms')}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Direct Messages ({backup.data.direct_messages.length} conversations)
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {expandedSection === `${backup.id}-dms` ? '−' : '+'}
                          </span>
                        </button>
                        {expandedSection === `${backup.id}-dms` && (
                          <div className="px-4 pb-4 max-h-96 overflow-auto">
                            <pre className="text-xs text-gray-800 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded whitespace-pre-wrap break-words overflow-x-hidden">
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