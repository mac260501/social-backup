'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { FileArchive, Globe } from 'lucide-react'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { createClient } from '@/lib/supabase/client'
import { formatBackupMethodLabel, isArchiveBackup } from '@/lib/platforms/backup'

type BackupRecord = {
  id: string
  backup_name?: string
  backup_type?: string
  backup_source?: string
  source?: string
  uploaded_at?: string
  created_at?: string
  file_size?: number
  data?: {
    profile?: {
      username?: string
    }
    uploaded_file_size?: number
    [key: string]: unknown
  }
  stats?: {
    tweets?: number
    media_files?: number
    followers?: number
    following?: number
    likes?: number
    dms?: number
  }
}

function formatDate(dateString?: string) {
  if (!dateString) return 'Unknown date'
  return new Date(dateString).toLocaleString('en-US', {
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

  const downloadBackup = async (backupId: string) => {
    try {
      const response = await fetch(`/api/platforms/twitter/download-archive?backupId=${encodeURIComponent(backupId)}`)
      const data = await response.json()

      if (!response.ok || !data.success || !data.downloadUrl) {
        throw new Error(data.error || 'This backup does not have a downloadable archive.')
      }

      window.location.href = data.downloadUrl
    } catch (error) {
      console.error('Download backup error:', error)
      alert(error instanceof Error ? error.message : 'Failed to download backup.')
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
                    <article
                      key={backup.id}
                      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#171717] p-4 transition hover:border-white/20 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div
                        className="flex min-w-0 cursor-pointer items-center gap-4"
                        onClick={() => router.push(`/dashboard/backup/${backup.id}`)}
                      >
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                            isArchiveBackup(backup)
                              ? 'bg-indigo-500/25 text-indigo-300'
                              : 'bg-pink-500/25 text-pink-300'
                          }`}
                        >
                          {isArchiveBackup(backup) ? <FileArchive size={20} /> : <Globe size={20} />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[0.96rem] leading-tight font-semibold text-white">
                            {backup.backup_name || formatBackupMethodLabel(backup)}
                          </p>
                          <p className="text-[0.9rem] text-gray-300">{formatDate(backup.uploaded_at || backup.created_at)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="mr-2 text-right">
                          <p className="font-mono tabular-nums text-[0.9rem] font-medium leading-none text-gray-200">
                            {isArchiveBackup(backup) ? formatSize(resolveBackupSize(backup)) : 'Snapshot'}
                          </p>
                        </div>
                        <button
                          onClick={() => router.push(`/dashboard/backup/${backup.id}`)}
                          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-200"
                        >
                          View
                        </button>
                        <button
                          onClick={() => downloadBackup(backup.id)}
                          disabled={!isArchiveBackup(backup)}
                          className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                        >
                          Download
                        </button>
                        <button
                          onClick={() => deleteBackup(backup.id, formatBackupMethodLabel(backup))}
                          className="rounded-full border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/25"
                        >
                          Delete
                        </button>
                      </div>
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
