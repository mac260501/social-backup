'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'

export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [backupsCount, setBackupsCount] = useState<number>(0)
  const [loadingBackups, setLoadingBackups] = useState(true)
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<any>(null)
  const [maxTweets, setMaxTweets] = useState(1000)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/')
    } else if (status === 'authenticated' && session?.user?.id) {
      fetchBackupsCount()
    }
  }, [status, session, router])

  const fetchBackupsCount = async () => {
    try {
      const response = await fetch(`/api/backups?userId=${encodeURIComponent(session?.user?.id || '')}`)
      const result = await response.json()
      if (result.success) {
        setBackupsCount(result.backups?.length || 0)
      }
    } catch (error) {
      console.error('Error fetching backups count:', error)
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('userId', session?.user?.id || '')
    formData.append('username', session?.user?.username || '')

    try {
      const response = await fetch('/api/upload-archive', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      setUploadResult(data)

      // Refresh backups count after successful upload
      if (data.success) {
        fetchBackupsCount()
      }
    } catch (error) {
      setUploadResult({ success: false, error: 'Failed to upload' })
    } finally {
      setUploading(false)
    }
  }

  const handleScrapeNow = async () => {
    if (!session?.user?.username) return

    setScraping(true)
    setScrapeResult(null)

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: session.user.username,
          maxTweets: maxTweets,
          userId: session.user.id,
        }),
      })

      const data = await response.json()
      setScrapeResult(data)

      // Refresh backups count after successful scrape
      if (data.success) {
        fetchBackupsCount()
      }
    } catch (error) {
      setScrapeResult({ success: false, error: 'Failed to scrape Twitter data' })
    } finally {
      setScraping(false)
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  if (!session) {
    return null
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
                  className="px-3 sm:px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
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
            className="flex-1 px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
          >
            Dashboard
          </button>
          <button
            onClick={() => router.push('/dashboard/backups')}
            className="flex-1 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border-b-2 border-transparent"
          >
            Backups
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg dark:shadow-gray-900/50 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Welcome back, @{session.user?.username}!</h2>
            <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full text-xs sm:text-sm font-medium">
              Free Tier
            </span>
          </div>

          {!loadingBackups && backupsCount > 0 && (
            <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-blue-900 dark:text-blue-300">Your Backups</h3>
                  <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-400 mt-1">
                    You have {backupsCount} backup{backupsCount !== 1 ? 's' : ''} saved
                  </p>
                </div>
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 transition text-xs sm:text-sm font-medium"
                >
                  View All →
                </button>
              </div>
            </div>
          )}

          <div className="border-t dark:border-gray-700 pt-6 mt-6">
          <h3 className="text-base sm:text-lg font-semibold mb-4 text-gray-900 dark:text-white">📥 Backup Your Twitter Data</h3>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4 mb-6">
            <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2 text-sm sm:text-base">How to get your Twitter archive:</h4>
            <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-blue-800 dark:text-blue-400">
                <li>
                  Go to{' '}
                  <a
                    href="https://twitter.com/settings/download_your_data"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    Twitter Settings → Download your data
                  </a>
                </li>
                <li>Request your archive (Twitter will email you in 24 hours)</li>
                <li>Download the ZIP file from the email</li>
                <li>Upload it here to back everything up!</li>
              </ol>

              <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/30 rounded">
                <p className="text-xs sm:text-sm font-semibold text-blue-900 dark:text-blue-300">✨ What gets backed up:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-xs sm:text-sm text-blue-800 dark:text-blue-400">
                  <div>✓ All your tweets</div>
                  <div>✓ All your media</div>
                  <div>✓ Your followers</div>
                  <div>✓ Your following</div>
                  <div>✓ All your likes</div>
                  <div>✓ Your DMs</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 sm:p-8 text-center hover:border-blue-400 dark:hover:border-blue-500 transition">
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
                className={`cursor-pointer inline-flex items-center px-4 sm:px-6 py-2 sm:py-3 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 transition text-sm sm:text-base ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {uploading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing Archive...
                  </>
                ) : (
                  '📤 Upload Twitter Archive (.zip)'
                )}
              </label>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-2">
                Your archive will be processed securely
              </p>
            </div>

            {uploadResult && (
              <div className={`mt-6 p-4 sm:p-6 rounded-lg ${uploadResult.success ? 'bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800'}`}>
                {uploadResult.success ? (
                  <>
                    <div className="flex items-center mb-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-500 dark:bg-green-600 rounded-full flex items-center justify-center text-white text-lg sm:text-xl mr-3">
                        ✓
                      </div>
                      <div>
                        <h4 className="text-base sm:text-lg font-semibold text-green-900 dark:text-green-300">{uploadResult.message}</h4>
                        <p className="text-xs sm:text-sm text-green-700 dark:text-green-400">Your data is now safely backed up!</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mt-4">
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">{uploadResult.stats.tweets.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Tweets</div>
                      </div>
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">{uploadResult.stats.followers.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Followers</div>
                      </div>
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">{uploadResult.stats.following.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Following</div>
                      </div>
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-red-600 dark:text-red-400">{uploadResult.stats.likes.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Likes</div>
                      </div>
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-indigo-600 dark:text-indigo-400">{uploadResult.stats.dms.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">DMs</div>
                      </div>
                    </div>

                    <div className="mt-6 text-center">
                      <button
                        onClick={() => router.push('/dashboard/backups')}
                        className="px-6 py-3 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 transition"
                      >
                        View All Backups →
                      </button>
                    </div>
                  </>

                ) : (
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-red-500 dark:bg-red-600 rounded-full flex items-center justify-center text-white text-xl mr-3">
                      ✗
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-red-900 dark:text-red-300">Upload Failed</h4>
                      <p className="text-sm text-red-700 dark:text-red-400">{uploadResult.error}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Automated Scraping Section */}
          <div className="border-t dark:border-gray-700 pt-6 mt-6">
            <h3 className="text-base sm:text-lg font-semibold mb-4 text-gray-900 dark:text-white">🚀 Automated Backup (Scraping)</h3>

            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3 sm:p-4 mb-6">
              <h4 className="font-semibold text-purple-900 dark:text-purple-300 mb-2 text-sm sm:text-base">Instant Twitter Scraping</h4>
              <p className="text-xs sm:text-sm text-purple-800 dark:text-purple-400 mb-3">
                Skip the wait! Scrape your Twitter data instantly without requesting an archive.
              </p>

              <div className="mt-4 p-3 bg-purple-100 dark:bg-purple-900/30 rounded">
                <p className="text-xs sm:text-sm font-semibold text-purple-900 dark:text-purple-300">✨ What gets scraped:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-xs sm:text-sm text-purple-800 dark:text-purple-400">
                  <div>✓ Your latest tweets</div>
                  <div>✓ Your followers</div>
                  <div>✓ Your following</div>
                  <div>✗ Likes (archive only)</div>
                  <div>✗ DMs (archive only)</div>
                </div>
                <p className="text-xs text-purple-700 dark:text-purple-400 mt-2 italic">
                  Note: For complete history including likes and DMs, use archive upload.
                </p>
              </div>
            </div>

            <div className="border-2 border-dashed border-purple-300 dark:border-purple-700 rounded-lg p-4 sm:p-8 text-center">
              <div className="mb-4">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Number of tweets to scrape:
                </label>
                <input
                  type="number"
                  value={maxTweets}
                  onChange={(e) => setMaxTweets(parseInt(e.target.value) || 1000)}
                  min="100"
                  max="3200"
                  step="100"
                  disabled={scraping}
                  className="w-28 sm:w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg text-center text-sm sm:text-base"
                />
              </div>

              <button
                onClick={handleScrapeNow}
                disabled={scraping}
                className={`inline-flex items-center px-4 sm:px-6 py-2 sm:py-3 bg-purple-500 dark:bg-purple-600 text-white rounded-lg hover:bg-purple-600 dark:hover:bg-purple-700 transition text-sm sm:text-base ${scraping ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {scraping ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Scraping in Progress...
                  </>
                ) : (
                  '⚡ Scrape Now'
                )}
              </button>
            </div>

            {scrapeResult && (
              <div className={`mt-6 p-4 sm:p-6 rounded-lg ${scrapeResult.success ? 'bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800'}`}>
                {scrapeResult.success ? (
                  <>
                    <div className="flex items-center mb-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-500 dark:bg-green-600 rounded-full flex items-center justify-center text-white text-lg sm:text-xl mr-3">
                        ✓
                      </div>
                      <div>
                        <h4 className="text-base sm:text-lg font-semibold text-green-900 dark:text-green-300">{scrapeResult.message}</h4>
                        <p className="text-xs sm:text-sm text-green-700 dark:text-green-400">Your data has been scraped and backed up!</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">{scrapeResult.data.tweets.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Tweets</div>
                      </div>
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">{scrapeResult.data.followers.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Followers</div>
                      </div>
                      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 text-center">
                        <div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">{scrapeResult.data.following.toLocaleString()}</div>
                        <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Following</div>
                      </div>
                    </div>

                    <div className="mt-6 text-center">
                      <button
                        onClick={() => router.push('/dashboard/backups')}
                        className="px-6 py-3 bg-purple-500 dark:bg-purple-600 text-white rounded-lg hover:bg-purple-600 dark:hover:bg-purple-700 transition"
                      >
                        View All Backups →
                      </button>
                    </div>
                  </>

                ) : (
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-red-500 dark:bg-red-600 rounded-full flex items-center justify-center text-white text-xl mr-3">
                      ✗
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-red-900 dark:text-red-300">Scraping Failed</h4>
                      <p className="text-sm text-red-700 dark:text-red-400">{scrapeResult.error}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}