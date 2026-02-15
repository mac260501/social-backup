'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { createClient } from '@/lib/supabase/client'
import { isArchiveBackup } from '@/lib/platforms/backup'

type BackupRecord = {
  id: string
  backup_name?: string
  backup_type?: string
  backup_source?: string
  source?: string
  uploaded_at?: string
  created_at?: string
  file_size?: number
  data?: Record<string, unknown>
  stats?: {
    tweets?: number
    media_files?: number
    followers?: number
    following?: number
    likes?: number
    dms?: number
  }
}

function backupLabel(backup: BackupRecord) {
  return isArchiveBackup(backup) ? 'Archive Backup' : 'Snapshot Backup'
}

function formatDate(dateString?: string) {
  if (!dateString) return 'Unknown date'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSize(bytes?: number) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return 'Size unavailable'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function parseSizeValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

export default function BackupsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<'all' | 'archive' | 'snapshot'>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'size_desc' | 'size_asc'>('newest')

  useEffect(() => {
    const init = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      if (!currentUser) {
        router.push('/login')
        return
      }

      setUser(currentUser)
      await fetchBackups()
      setAuthLoading(false)
    }

    init()
  }, [router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const fetchBackups = async () => {
    try {
      const response = await fetch('/api/backups')
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

  const deleteBackup = async (backupId: string, label: string) => {
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return

    try {
      const response = await fetch(`/api/backups/delete?backupId=${encodeURIComponent(backupId)}`, {
        method: 'DELETE',
      })
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete backup')
      }

      await fetchBackups()
    } catch (error) {
      console.error('Error deleting backup:', error)
      alert('Failed to delete backup. Please try again.')
    }
  }

  const resolveBackupSize = (backup: BackupRecord) => {
    const candidates: unknown[] = [
      backup.file_size,
      backup.data?.uploaded_file_size,
      backup.data?.file_size,
      backup.data?.archive_size,
      backup.data?.size,
    ]
    for (const value of candidates) {
      const parsed = parseSizeValue(value)
      if (parsed > 0) return parsed
    }
    return 0
  }

  const filteredAndSortedBackups = useMemo(() => {
    const filtered = backups.filter((backup) => {
      if (filterType === 'all') return true
      if (filterType === 'archive') return isArchiveBackup(backup)
      return !isArchiveBackup(backup)
    })

    return [...filtered].sort((a, b) => {
      const timeA = new Date(a.uploaded_at || a.created_at || 0).getTime()
      const timeB = new Date(b.uploaded_at || b.created_at || 0).getTime()
      const sizeA = resolveBackupSize(a)
      const sizeB = resolveBackupSize(b)

      if (sortBy === 'oldest') return timeA - timeB
      if (sortBy === 'size_desc') return sizeB - sizeA
      if (sortBy === 'size_asc') return sizeA - sizeB
      return timeB - timeA
    })
  }, [backups, filterType, sortBy])

  const totalArchiveCount = useMemo(
    () => backups.filter((backup) => isArchiveBackup(backup)).length,
    [backups]
  )

  const totalSizeBytes = useMemo(
    () => backups.reduce((sum, backup) => sum + resolveBackupSize(backup), 0),
    [backups]
  )

  if (authLoading || loading) {
    return <ThemeLoadingScreen label="Loading backups..." />
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-[1440px] px-0 sm:px-4">
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[275px_minmax(0,1fr)]">
          <aside className="hidden border-r border-white/10 p-5 md:block">
            <div className="sticky top-5 space-y-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full rounded-full px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-white/10"
              >
                ← Back to dashboard
              </button>

              <button
                onClick={() => router.push('/dashboard/backups')}
                className="w-full rounded-full bg-white/10 px-4 py-3 text-left text-[15px] font-semibold"
              >
                Backups
              </button>

              <button
                onClick={handleSignOut}
                className="w-full rounded-full px-4 py-3 text-left text-[15px] font-medium text-gray-300 transition hover:bg-white/10 hover:text-white"
              >
                Sign out
              </button>
            </div>
          </aside>

          <main className="min-w-0">
            <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 px-4 py-4 backdrop-blur sm:px-6">
              <h1 className="text-2xl font-bold">Your Backups</h1>
              <p className="mt-1 text-sm text-gray-400">Open and manage your archived snapshots.</p>
            </header>

            <div className="px-4 py-5 sm:px-6">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#0b0b0b] px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Total Archives</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{totalArchiveCount}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0b0b0b] px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Total Storage Used</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{formatSize(totalSizeBytes)}</p>
                </div>
              </div>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex rounded-full border border-white/10 bg-[#0b0b0b] p-1">
                  <button
                    onClick={() => setFilterType('all')}
                    className={`rounded-full px-3 py-1.5 text-sm ${filterType === 'all' ? 'bg-white text-black' : 'text-gray-300'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilterType('archive')}
                    className={`rounded-full px-3 py-1.5 text-sm ${filterType === 'archive' ? 'bg-white text-black' : 'text-gray-300'}`}
                  >
                    Archives
                  </button>
                  <button
                    onClick={() => setFilterType('snapshot')}
                    className={`rounded-full px-3 py-1.5 text-sm ${filterType === 'snapshot' ? 'bg-white text-black' : 'text-gray-300'}`}
                  >
                    Snapshots
                  </button>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0b0b0b] px-3 py-2">
                  <span className="text-sm text-gray-400">Sort</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="bg-transparent text-sm text-white outline-none"
                  >
                    <option className="bg-black" value="newest">Newest</option>
                    <option className="bg-black" value="oldest">Oldest</option>
                    <option className="bg-black" value="size_desc">Largest Size</option>
                    <option className="bg-black" value="size_asc">Smallest Size</option>
                  </select>
                </div>
              </div>

              {filteredAndSortedBackups.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#0b0b0b] p-8 text-center">
                  <p className="text-gray-300">No backups match this filter.</p>
                  <button
                    onClick={() => setFilterType('all')}
                    className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-gray-200"
                  >
                    Show all backups
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredAndSortedBackups.map((backup) => (
                    <article key={backup.id} className="rounded-2xl border border-white/10 bg-[#0b0b0b] p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-lg font-semibold text-white">{backup.backup_name || backupLabel(backup)}</p>
                          <p className="mt-1 text-sm text-gray-400">Captured {formatDate(backup.uploaded_at || backup.created_at)}</p>
                          <p className="mt-1 text-sm text-gray-500">{formatSize(resolveBackupSize(backup))}</p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => router.push(`/dashboard/backup/${backup.id}`)}
                            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-200"
                          >
                            View
                          </button>
                          <button
                            onClick={() => deleteBackup(backup.id, backupLabel(backup))}
                            className="rounded-full border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/25"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {backup.stats && (
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                          <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-gray-300">Posts <span className="ml-1 font-semibold text-white">{backup.stats.tweets?.toLocaleString() || 0}</span></div>
                          <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-gray-300">Media <span className="ml-1 font-semibold text-white">{backup.stats.media_files?.toLocaleString() || 0}</span></div>
                          <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-gray-300">Followers <span className="ml-1 font-semibold text-white">{backup.stats.followers?.toLocaleString() || 0}</span></div>
                          <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-gray-300">Following <span className="ml-1 font-semibold text-white">{backup.stats.following?.toLocaleString() || 0}</span></div>
                          <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-gray-300">Likes <span className="ml-1 font-semibold text-white">{backup.stats.likes?.toLocaleString() || 0}</span></div>
                          <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-gray-300">DMs <span className="ml-1 font-semibold text-white">{backup.stats.dms?.toLocaleString() || 0}</span></div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
