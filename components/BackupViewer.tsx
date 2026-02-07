'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/theme-toggle'
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const tabs = [
    { id: 'tweets' as Tab, label: 'Tweets', count: backup.stats?.tweets || 0 },
    { id: 'media' as Tab, label: 'Media', count: backup.stats?.media_files || 0 },
    { id: 'dms' as Tab, label: 'DMs', count: backup.stats?.dms || 0 },
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
            <ThemeToggle />
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
            <div className="relative">
              <input
                type="text"
                placeholder="Search backup..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 pl-10 bg-gray-100 dark:bg-gray-700 border-none rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
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

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'tweets' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            {backup.data?.tweets && backup.data.tweets.length > 0 ? (
              <TweetsTab tweets={backup.data.tweets} />
            ) : (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400">
                No tweets found
              </div>
            )}
          </div>
        )}

        {activeTab === 'media' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            {backup.data?.tweets && backup.data.tweets.length > 0 ? (
              <MediaTab tweets={backup.data.tweets} />
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No media found</p>
            )}
          </div>
        )}

        {activeTab === 'dms' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Direct Messages</h2>
            {backup.data?.direct_messages && backup.data.direct_messages.length > 0 ? (
              <DMsTab dms={backup.data.direct_messages} userId={backup.userId} />
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
