'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-semibold text-gray-900">Social Backup</h1>
              <div className="flex space-x-1">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="px-4 py-2 text-sm font-medium text-blue-600 border-b-2 border-blue-600"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
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
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back, @{session.user?.username}!</h2>
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              Free Tier
            </span>
          </div>

          {!loadingBackups && backupsCount > 0 && (
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-blue-900">Your Backups</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    You have {backupsCount} backup{backupsCount !== 1 ? 's' : ''} saved
                  </p>
                </div>
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm font-medium"
                >
                  View All →
                </button>
              </div>
            </div>
          )}

          <div className="border-t pt-6 mt-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">📥 Backup Your Twitter Data</h3>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="font-semibold text-blue-900 mb-2 font-bold">How to get your Twitter archive:</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                <li>
                  Go to{' '}
                  <a 
                    href="https://twitter.com/settings/download_your_data" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold"
                  >
                    Twitter Settings → Download your data
                  </a>
                </li>
                <li>Request your archive (Twitter will email you in 24 hours)</li>
                <li>Download the ZIP file from the email</li>
                <li>Upload it here to back everything up!</li>
              </ol>
              
              <div className="mt-4 p-3 bg-blue-100 rounded">
                <p className="text-sm font-semibold text-blue-900">✨ What gets backed up:</p>
                <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-blue-800">
                  <div>✓ All your tweets</div>
                  <div>✓ All your media</div>
                  <div>✓ Your followers</div>
                  <div>✓ Your following</div>
                  <div>✓ All your likes</div>
                  <div>✓ Your DMs</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition">
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
                className={`cursor-pointer inline-flex items-center px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
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
              <p className="text-sm text-gray-500 mt-2">
                Your archive will be processed securely
              </p>
            </div>

            {uploadResult && (
              <div className={`mt-6 p-6 rounded-lg ${uploadResult.success ? 'bg-green-50 border-2 border-green-200' : 'bg-red-50 border-2 border-red-200'}`}>
                {uploadResult.success ? (
                  <>
                    <div className="flex items-center mb-4">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white text-xl mr-3">
                        ✓
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-green-900">{uploadResult.message}</h4>
                        <p className="text-sm text-green-700">Your data is now safely backed up!</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-blue-600">{uploadResult.stats.tweets.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Tweets</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-purple-600">{uploadResult.stats.followers.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Followers</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-green-600">{uploadResult.stats.following.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Following</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-red-600">{uploadResult.stats.likes.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Likes</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{uploadResult.stats.dms.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">DMs</div>
                      </div>
                    </div>

                    <div className="mt-6 text-center">
                      <button
                        onClick={() => router.push('/dashboard/backups')}
                        className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
                      >
                        View All Backups →
                      </button>
                    </div>
                  </>
                  
                ) : (
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white text-xl mr-3">
                      ✗
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-red-900">Upload Failed</h4>
                      <p className="text-sm text-red-700">{uploadResult.error}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Automated Scraping Section */}
          <div className="border-t pt-6 mt-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">🚀 Automated Backup (Scraping)</h3>

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
              <h4 className="font-semibold text-purple-900 mb-2">Instant Twitter Scraping</h4>
              <p className="text-sm text-purple-800 mb-3">
                Skip the wait! Scrape your Twitter data instantly without requesting an archive.
              </p>

              <div className="mt-4 p-3 bg-purple-100 rounded">
                <p className="text-sm font-semibold text-purple-900">✨ What gets scraped:</p>
                <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-purple-800">
                  <div>✓ Your latest tweets</div>
                  <div>✓ Followers (up to 1,000)</div>
                  <div>✓ Following (up to 1,000)</div>
                  <div>✗ Likes (archive only)</div>
                  <div>✗ DMs (archive only)</div>
                </div>
                <p className="text-xs text-purple-700 mt-2 italic">
                  Note: Uses apidojo/tweet-scraper for tweets and apidojo/twitter-user-scraper for followers/following.
                </p>
              </div>

              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-sm text-red-800">
                  <span className="font-semibold">⚠️ Requirements:</span> Requires a paid Apify plan ($49/month). Free tier not supported.
                </p>
                <a
                  href="https://apify.com/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-red-700 underline hover:text-red-900 mt-1 inline-block"
                >
                  View Apify pricing →
                </a>
              </div>

              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm text-yellow-800">
                  <span className="font-semibold">💰 Cost:</span> Apify plan ($49/mo) + ~$0.40 per 1,000 tweets scraped
                </p>
              </div>
            </div>

            <div className="border-2 border-dashed border-purple-300 rounded-lg p-8 text-center">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-center"
                />
              </div>

              <button
                onClick={handleScrapeNow}
                disabled={scraping}
                className={`inline-flex items-center px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition ${scraping ? 'opacity-50 cursor-not-allowed' : ''}`}
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
              <p className="text-sm text-gray-500 mt-2">
                Estimated cost: ${((maxTweets / 1000) * 0.4).toFixed(2)}
              </p>
            </div>

            {scrapeResult && (
              <div className={`mt-6 p-6 rounded-lg ${scrapeResult.success ? 'bg-green-50 border-2 border-green-200' : 'bg-red-50 border-2 border-red-200'}`}>
                {scrapeResult.success ? (
                  <>
                    <div className="flex items-center mb-4">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white text-xl mr-3">
                        ✓
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-green-900">{scrapeResult.message}</h4>
                        <p className="text-sm text-green-700">Your data has been scraped and backed up!</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-blue-600">{scrapeResult.data.tweets.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Tweets</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-purple-600">{scrapeResult.data.followers.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Followers</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-green-600">{scrapeResult.data.following.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 mt-1">Following</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-orange-600">${scrapeResult.data.cost.toFixed(2)}</div>
                        <div className="text-sm text-gray-600 mt-1">Total Cost</div>
                      </div>
                    </div>

                    <div className="mt-6 text-center">
                      <button
                        onClick={() => router.push('/dashboard/backups')}
                        className="px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition"
                      >
                        View All Backups →
                      </button>
                    </div>
                  </>

                ) : (
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white text-xl mr-3">
                      ✗
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-red-900">Scraping Failed</h4>
                      <p className="text-sm text-red-700">{scrapeResult.error}</p>
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