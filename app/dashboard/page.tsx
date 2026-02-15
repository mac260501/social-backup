'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Download, Globe, MoreHorizontal, FileArchive } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { createClient } from '@/lib/supabase/client'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'

type PlatformTab = 'x' | 'instagram' | 'tiktok' | 'account'

type UploadResult = {
  success: boolean
  message?: string
  error?: string
  stats?: {
    tweets?: number
    followers?: number
    following?: number
    likes?: number
    dms?: number
    media_files?: number
  }
}

type ScrapeResult = {
  success: boolean
  message?: string
  error?: string
  data?: {
    tweets?: number
    followers?: number
    following?: number
    media_files?: number
  }
}

type BackupItem = {
  id: string
  backup_type?: string | null
  source?: string | null
  backup_name?: string | null
  backup_source?: string | null
  uploaded_at?: string | null
  created_at?: string | null
  file_size?: number | null
  stats?: {
    tweets?: number
    followers?: number
    following?: number
    likes?: number
    dms?: number
    media_files?: number
  } | null
  data?: {
    profile?: {
      username?: string
    }
    uploaded_file_size?: number
  } | null
}

function SidebarButton({
  active,
  label,
  onClick,
  muted,
}: {
  active: boolean
  label: string
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
        active
          ? 'bg-gradient-to-r from-[#2e5bff] to-[#4f46e5] text-white shadow-[0_10px_24px_rgba(79,70,229,0.35)]'
          : muted
            ? 'text-gray-400 dark:text-gray-500 hover:bg-white/5'
            : 'text-gray-700 dark:text-gray-300 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  )
}

function ComingSoonPanel({ platform, description }: { platform: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 p-8 text-center dark:border-white/15 dark:bg-white/5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Coming Soon</p>
      <h2 className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">{platform} backups are coming soon</h2>
      <p className="mx-auto mt-3 max-w-2xl text-base text-gray-600 dark:text-gray-300">{description}</p>
    </div>
  )
}

export default function Dashboard() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<PlatformTab>('x')

  const [displayName, setDisplayName] = useState('')
  const [twitterUsername, setTwitterUsername] = useState('')

  const [backupsCount, setBackupsCount] = useState<number>(0)
  const [loadingBackups, setLoadingBackups] = useState(true)
  const [backups, setBackups] = useState<BackupItem[]>([])

  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)

  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null)

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

      const metadataName =
        (currentUser.user_metadata?.full_name as string | undefined) ||
        (currentUser.user_metadata?.name as string | undefined) ||
        (currentUser.user_metadata?.display_name as string | undefined) ||
        ''

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', currentUser.id)
        .maybeSingle()

      const resolvedName =
        profile?.display_name || metadataName || currentUser.email?.split('@')[0] || 'User'
      setDisplayName(resolvedName)

      if (!profile?.display_name && metadataName) {
        await supabase.from('profiles').update({ display_name: metadataName }).eq('id', currentUser.id)
      }

      setTwitterUsername(
        (currentUser.user_metadata?.user_name as string | undefined) ||
          (currentUser.user_metadata?.preferred_username as string | undefined) ||
          ''
      )

      await fetchBackupsSummary()
      setAuthLoading(false)
    }

    init()
  }, [router, supabase])

  const fetchBackupsSummary = async () => {
    try {
      const response = await fetch('/api/backups')
      const result = (await response.json()) as { success?: boolean; backups?: BackupItem[] }
      if (result.success) {
        const list = result.backups || []
        setBackups(list)
        setBackupsCount(list.length)
      }
    } catch (error) {
      console.error('Error fetching backups count:', error)
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadResult(null)

    const formData = new FormData()
    formData.append('file', file)
    if (twitterUsername) {
      formData.append('username', twitterUsername)
    }

    try {
      const response = await fetch('/api/upload-archive', {
        method: 'POST',
        body: formData,
      })

      const data = (await response.json()) as UploadResult
      setUploadResult(data)

      if (data.success) {
        fetchBackupsSummary()
      }
    } catch (error) {
      console.error('Upload error:', error)
      setUploadResult({ success: false, error: 'Failed to upload archive' })
    } finally {
      setUploading(false)
    }
  }

  const handleScrapeNow = async () => {
    if (!twitterUsername.trim()) return

    setScraping(true)
    setScrapeResult(null)

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: twitterUsername.trim(),
        }),
      })

      const data = (await response.json()) as ScrapeResult
      setScrapeResult(data)

      if (data.success) {
        fetchBackupsSummary()
      }
    } catch (error) {
      console.error('Scrape error:', error)
      setScrapeResult({ success: false, error: 'Failed to scrape X data' })
    } finally {
      setScraping(false)
    }
  }

  if (authLoading) {
    return <ThemeLoadingScreen label="Loading your dashboard..." />
  }

  if (!user) {
    return null
  }

  const recentBackups = backups.slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 dark:bg-black dark:text-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_1fr]">
        <aside className="flex flex-col border-b border-gray-200 bg-[#0a1434] p-4 lg:border-b-0 lg:border-r lg:border-white/10 lg:p-5">
          <div className="mb-6 flex items-center justify-between lg:justify-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200/70">Social Backup</p>
              <h1 className="text-xl font-bold text-white">Dashboard</h1>
            </div>
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>

          <div className="space-y-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200/70">Platforms</p>
            <SidebarButton active={activeTab === 'x'} label="X (Twitter)" onClick={() => setActiveTab('x')} />
            <SidebarButton active={activeTab === 'instagram'} label="Instagram" onClick={() => setActiveTab('instagram')} muted />
            <SidebarButton active={activeTab === 'tiktok'} label="TikTok" onClick={() => setActiveTab('tiktok')} muted />
          </div>

          <div className="mt-auto space-y-2 pt-8">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200/70">Settings</p>
            <SidebarButton active={activeTab === 'account'} label="Account" onClick={() => setActiveTab('account')} />
          </div>

          <button
            onClick={handleSignOut}
            className="mt-4 w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Sign Out
          </button>
        </aside>

        <main className="p-6 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Hi, {displayName}</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Keep your social history safe and accessible.</p>
              </div>
              <div className="hidden items-center gap-4 lg:flex">
                <div className="text-right">
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">{displayName}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Free Plan</p>
                </div>
                <ThemeToggle />
              </div>
            </div>

            {activeTab === 'x' && (
              <div className="space-y-10">
                <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white">X (Twitter) Backup</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Choose one: upload your full archive or take a current snapshot.</p>
                  </div>
                  <button
                    onClick={() => router.push('/dashboard/backups')}
                    className="rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1]"
                  >
                    View Backups ({backupsCount})
                  </button>
                </div>
              </section>

                <section className="grid gap-7 xl:grid-cols-2">
                  <div className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white">Upload Archive</h4>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Best for complete history backup.</p>

                  <div className="mt-5 space-y-3">
                    <details className="group rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/5">
                      <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-white">
                        <span className="inline-flex items-center gap-2">
                          <span className="transition group-open:rotate-90">›</span>
                          How to get your archive
                        </span>
                      </summary>
                      <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                        <ol className="list-decimal space-y-1 pl-5">
                          <li>Open X account data settings.</li>
                          <li>Request your archive.</li>
                          <li>Download the ZIP when it is ready.</li>
                        </ol>
                        <a
                          href="https://twitter.com/settings/download_your_data"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-block font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Go to X archive page
                        </a>
                      </div>
                    </details>

                    <details className="group rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/5">
                      <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-white">
                        <span className="inline-flex items-center gap-2">
                          <span className="transition group-open:rotate-90">›</span>
                          What is included / not included
                        </span>
                      </summary>
                      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                          <p className="font-medium text-gray-900 dark:text-white">Included</p>
                          <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                            <li>✓ Full tweet history</li>
                            <li>✓ Media files</li>
                            <li>✓ Followers & following</li>
                            <li>✓ Likes & DMs</li>
                          </ul>
                        </div>
                        <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                          <p className="font-medium text-gray-900 dark:text-white">Not included</p>
                          <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                            <li>✗ New activity after archive date</li>
                          </ul>
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center dark:border-white/20">
                    <input
                      type="file"
                      accept=".zip"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className={`inline-block rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      {uploading ? 'Processing...' : 'Choose ZIP File'}
                    </label>
                  </div>

                  {uploadResult && (
                    <p className={`mt-4 text-sm ${uploadResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {uploadResult.success ? uploadResult.message || 'Archive uploaded successfully.' : uploadResult.error || 'Upload failed.'}
                    </p>
                  )}
                </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white">Take Current Snapshot</h4>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Fast backup of your current public profile data.</p>

                  <details className="group mt-5 rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/5">
                    <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-white">
                      <span className="inline-flex items-center gap-2">
                        <span className="transition group-open:rotate-90">›</span>
                        What is included / not included
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                        <p className="font-medium text-gray-900 dark:text-white">Included</p>
                        <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                          <li>✓ Recent tweets</li>
                          <li>✓ Media from fetched tweets</li>
                          <li>✓ Followers & following</li>
                        </ul>
                      </div>
                      <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                        <p className="font-medium text-gray-900 dark:text-white">Not included</p>
                        <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                          <li>✗ Likes</li>
                          <li>✗ DMs</li>
                          <li>✗ Older content outside fetched range</li>
                        </ul>
                      </div>
                    </div>
                  </details>

                  <div className="mt-5 space-y-3">
                    <input
                      type="text"
                      value={twitterUsername}
                      onChange={(e) => setTwitterUsername(e.target.value.replace(/^@/, ''))}
                      placeholder="X username"
                      disabled={scraping}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-white/20 dark:bg-black/40 dark:text-white"
                    />
                    <button
                      onClick={handleScrapeNow}
                      disabled={scraping || !twitterUsername.trim()}
                      className="w-full rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(21,118,232,0.35)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {scraping ? 'Creating snapshot...' : 'Take Snapshot'}
                    </button>
                  </div>

                  {scrapeResult && (
                    <p className={`mt-4 text-sm ${scrapeResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {scrapeResult.success ? scrapeResult.message || 'Scrape completed.' : scrapeResult.error || 'Scrape failed.'}
                    </p>
                  )}
                </div>
              </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-base font-semibold text-gray-900 dark:text-white">Recent Backups</h4>
                  <button
                    onClick={() => router.push('/dashboard/backups')}
                    className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View all
                  </button>
                </div>

                {loadingBackups ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">Loading backups...</p>
                ) : recentBackups.length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">No backups yet. Upload an archive or take a snapshot to get started.</p>
                ) : (
                  <div className="space-y-3">
                    {recentBackups.map((backup) => {
                      const isArchive =
                        backup.backup_type === 'full_archive' ||
                        backup.source === 'archive' ||
                        backup.backup_source === 'archive_upload' ||
                        Boolean(backup.data?.uploaded_file_size)
                      const usernameSuffix = backup.data?.profile?.username ? ` @${backup.data.profile.username}` : ''
                      const methodLabel = isArchive
                        ? `Archive Backup${usernameSuffix}`
                        : `Current Snapshot${usernameSuffix}`
                      const dateValue = backup.uploaded_at || backup.created_at
                      const formattedDate = dateValue
                        ? new Date(dateValue).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Unknown date'
                      const rawSize = backup.file_size || backup.data?.uploaded_file_size || 0
                      const sizeLabel = rawSize > 0 ? `${(rawSize / (1024 * 1024)).toFixed(1)} MB` : 'Snapshot'
                      const iconWrapClass = isArchive
                        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                        : 'bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300'

                      return (
                        <div
                          key={backup.id}
                          className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 transition hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div
                            className="flex min-w-0 cursor-pointer items-center gap-4"
                            onClick={() => router.push(`/dashboard/backup/${backup.id}`)}
                          >
                            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${iconWrapClass}`}>
                              {isArchive ? <FileArchive size={20} /> : <Globe size={20} />}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[0.96rem] leading-tight font-semibold text-gray-900 dark:text-white">{methodLabel}</p>
                              <p className="text-[0.9rem] text-gray-600 dark:text-gray-300">{formattedDate}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-6 text-sm text-gray-600 dark:text-gray-300 sm:gap-8">
                            <div className="text-right">
                              <p className="font-mono tabular-nums text-[0.9rem] font-medium leading-none text-gray-700 dark:text-gray-200">{sizeLabel}</p>
                            </div>
                            <button
                              onClick={() => router.push(`/dashboard/backup/${backup.id}`)}
                              className="rounded-md p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                              aria-label="Open backup details"
                            >
                              <Download size={20} />
                            </button>
                            <button
                              className="rounded-md p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                              aria-label="More actions"
                            >
                              <MoreHorizontal size={20} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
              </div>
            )}

            {activeTab === 'instagram' && (
              <ComingSoonPanel
                platform="Instagram"
                description="We are keeping this minimal for now. Instagram backup support is on the roadmap and will appear here once ready."
              />
            )}

            {activeTab === 'tiktok' && (
              <ComingSoonPanel
                platform="TikTok"
                description="TikTok backup support is in planning. This section will activate as soon as we ship the first version."
              />
            )}

            {activeTab === 'account' && (
              <section className="rounded-3xl border border-gray-200 bg-white p-7 dark:border-white/10 dark:bg-white/5">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Account</h3>
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-gray-600 dark:text-gray-300">
                    <span className="font-medium text-gray-900 dark:text-white">Name:</span> {displayName}
                  </p>
                  <p className="text-gray-600 dark:text-gray-300">
                    <span className="font-medium text-gray-900 dark:text-white">Email:</span> {user.email}
                  </p>
                  <p className="text-gray-600 dark:text-gray-300">
                    <span className="font-medium text-gray-900 dark:text-white">User ID:</span> {user.id}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="mt-6 rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                >
                  Sign Out
                </button>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
