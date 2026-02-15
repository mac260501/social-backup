'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ThemeToggle } from '@/components/theme-toggle'
import { createClient } from '@/lib/supabase/client'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { InstagramPanel } from '@/components/dashboard/platforms/InstagramPanel'
import { TikTokPanel } from '@/components/dashboard/platforms/TikTokPanel'
import { TwitterPanel, type DashboardBackupItem, type ScrapeResult, type UploadResult } from '@/components/dashboard/platforms/TwitterPanel'
import { inferBackupPlatform } from '@/lib/platforms/backup'
import { listPlatformDefinitions } from '@/lib/platforms/registry'
import type { PlatformId } from '@/lib/platforms/types'

type DashboardTab = PlatformId | 'account'

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

export default function Dashboard() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const platforms = useMemo(() => listPlatformDefinitions(), [])

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DashboardTab>('twitter')

  const [displayName, setDisplayName] = useState('')
  const [twitterUsername, setTwitterUsername] = useState('')

  const [backupsCount, setBackupsCount] = useState<number>(0)
  const [loadingBackups, setLoadingBackups] = useState(true)
  const [backups, setBackups] = useState<DashboardBackupItem[]>([])

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
      const result = (await response.json()) as { success?: boolean; backups?: DashboardBackupItem[] }
      if (result.success) {
        const list = (result.backups || []).filter((backup) => inferBackupPlatform(backup) === 'twitter')
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

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
      const response = await fetch('/api/platforms/twitter/upload-archive', {
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
      const response = await fetch('/api/platforms/twitter/scrape', {
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
            {platforms.map((platform) => (
              <SidebarButton
                key={platform.id}
                active={activeTab === platform.id}
                label={platform.label}
                onClick={() => setActiveTab(platform.id)}
                muted={!platform.enabled}
              />
            ))}
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

            {activeTab === 'twitter' && (
              <TwitterPanel
                backupsCount={backupsCount}
                loadingBackups={loadingBackups}
                recentBackups={recentBackups}
                uploading={uploading}
                uploadResult={uploadResult}
                scraping={scraping}
                scrapeResult={scrapeResult}
                twitterUsername={twitterUsername}
                setTwitterUsername={setTwitterUsername}
                onViewBackups={() => router.push('/dashboard/backups')}
                onOpenBackup={(backupId) => router.push(`/dashboard/backup/${backupId}`)}
                onUploadChange={handleFileUpload}
                onScrapeNow={handleScrapeNow}
              />
            )}

            {activeTab === 'instagram' && <InstagramPanel />}

            {activeTab === 'tiktok' && <TikTokPanel />}

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
