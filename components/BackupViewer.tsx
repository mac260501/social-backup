'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/theme-toggle'
import { SearchBar } from '@/components/SearchBar'
import { TweetsTab } from '@/components/backup-tabs/TweetsTab'
import { MediaTab } from '@/components/backup-tabs/MediaTab'
import { DMsTab } from '@/components/backup-tabs/DMsTab'
import { PeopleTab } from '@/components/backup-tabs/PeopleTab'
import { StatsTab } from '@/components/backup-tabs/StatsTab'
import { RawDataTab } from '@/components/backup-tabs/RawDataTab'

interface BackupViewerProps {
  backup: any
}

type Tab = 'tweets' | 'media' | 'dms' | 'people' | 'stats' | 'raw'

export function BackupViewer({ backup }: BackupViewerProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('tweets')
  const [searchQuery, setSearchQuery] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)

  useEffect(() => {
    // Fetch signed URLs for profile/cover photos (the bucket is private, public URLs don't work)
    if (backup.data?.profile?.profileImageUrl || backup.data?.profile?.coverImageUrl) {
      fetch(`/api/profile-media?backupId=${backup.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            if (data.profileImageUrl) setProfileImageUrl(data.profileImageUrl)
            if (data.coverImageUrl) setCoverImageUrl(data.coverImageUrl)
          }
        })
        .catch(() => {
          // Keep the stored URLs as fallback
        })
    }
  }, [backup.id, backup.data?.profile?.profileImageUrl, backup.data?.profile?.coverImageUrl])

  const handleDownloadArchive = async () => {
    try {
      setIsDownloading(true)
      const response = await fetch(`/api/download-archive?backupId=${backup.id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to download archive')
      }

      if (data.success && data.downloadUrl) {
        // Trigger download
        window.location.href = data.downloadUrl
      }
    } catch (error) {
      console.error('Error downloading archive:', error)
      alert(error instanceof Error ? error.message : 'Failed to download archive')
    } finally {
      setIsDownloading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Get DMs from multiple possible field names
  const getDMs = () => {
    return backup.data?.dms || backup.data?.direct_messages || backup.data?.directMessages || []
  }

  const dms = getDMs()

  const tabs = [
    { id: 'tweets' as Tab, label: 'Tweets', count: backup.stats?.tweets || 0 },
    { id: 'media' as Tab, label: 'Media', count: backup.stats?.media_files || 0 },
    { id: 'dms' as Tab, label: 'DMs', count: dms.length || backup.stats?.dms || 0 },
    { id: 'people' as Tab, label: 'People', count: (backup.stats?.followers || 0) + (backup.stats?.following || 0) },
    { id: 'stats' as Tab, label: 'Stats', count: null },
    { id: 'raw' as Tab, label: 'Raw Data', count: null },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/dashboard/backups')}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  {backup.backup_name || 'Backup'}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatDate(backup.uploaded_at || backup.created_at)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Download Archive Button */}
              {backup.archive_file_path && (
                <button
                  onClick={handleDownloadArchive}
                  disabled={isDownloading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg transition font-medium text-sm"
                  title="Download original archive ZIP"
                >
                  {isDownloading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Downloading...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download Archive
                    </>
                  )}
                </button>
              )}
              <ThemeToggle />
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex items-center space-x-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {backup.stats?.tweets?.toLocaleString() || 0}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Tweets</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {backup.stats?.followers?.toLocaleString() || 0}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Followers</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {backup.stats?.following?.toLocaleString() || 0}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Following</span>
            </div>
            {backup.stats?.media_files > 0 && (
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {backup.stats.media_files.toLocaleString()}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">Media</span>
              </div>
            )}
          </div>

          {/* Search Bar */}
          <div className="py-3">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={
                activeTab === 'tweets'
                  ? 'Search tweets...'
                  : activeTab === 'people'
                  ? 'Search people...'
                  : activeTab === 'dms'
                  ? 'Search messages...'
                  : 'Search backup...'
              }
            />
          </div>

          {/* Tabs */}
          <div className="flex space-x-8 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {tab.label}
                {tab.count !== null && (
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    ({tab.count.toLocaleString()})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Profile Banner */}
      {(backup.data?.profile?.coverImageUrl || backup.data?.profile?.profileImageUrl) && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="relative">
            {/* Cover photo */}
            <div className="rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700">
              {coverImageUrl ? (
                <img
                  src={coverImageUrl}
                  alt="Cover photo"
                  className="w-full h-40 sm:h-56 object-cover"
                />
              ) : (
                <div className="w-full h-40 sm:h-56 bg-gradient-to-r from-blue-400 to-blue-600" />
              )}
            </div>
            {/* Profile picture overlay — outside overflow-hidden so it isn't clipped */}
            {profileImageUrl && (
              <div className="absolute left-6 bottom-0 translate-y-1/2">
                <img
                  src={profileImageUrl}
                  alt={backup.data.profile.displayName || backup.data.profile.username || 'Profile'}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-white dark:border-gray-900 object-cover shadow-lg"
                />
              </div>
            )}
          </div>
          {/* Name under banner */}
          <div className="mt-14 sm:mt-16 pb-2">
            {backup.data.profile.displayName && (
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {backup.data.profile.displayName}
              </p>
            )}
            {backup.data.profile.username && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                @{backup.data.profile.username}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'tweets' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            {backup.data?.tweets && backup.data.tweets.length > 0 ? (
              <TweetsTab tweets={backup.data.tweets} searchQuery={searchQuery} ownerProfileImageUrl={profileImageUrl} />
            ) : (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400">
                No tweets found
              </div>
            )}
          </div>
        )}

        {activeTab === 'media' && (
          <MediaTab backupId={backup.id} searchQuery={searchQuery} />
        )}

        {activeTab === 'dms' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Direct Messages</h2>
            {dms && dms.length > 0 ? (
              <DMsTab dms={dms} userId={backup.userId} searchQuery={searchQuery} />
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No direct messages found</p>
            )}
          </div>
        )}

        {activeTab === 'people' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <PeopleTab
              followers={backup.data?.followers || []}
              following={backup.data?.following || []}
            />
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <StatsTab backup={backup} tweets={backup.data?.tweets || []} />
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <RawDataTab backup={backup} />
          </div>
        )}
      </main>
    </div>
  )
}
