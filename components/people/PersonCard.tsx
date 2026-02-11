'use client'

import { ExternalLink } from 'lucide-react'

interface PersonCardProps {
  person: any
}

export function PersonCard({ person }: PersonCardProps) {
  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-blue-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-red-500',
      'bg-indigo-500',
      'bg-teal-500'
    ]
    const index = (name?.charCodeAt(0) || 0) % colors.length
    return colors[index]
  }

  const getInitials = (name: string) => {
    if (!name) return '?'
    const parts = name.trim().split(' ')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  // Extract @username from a Twitter/X profile URL like https://twitter.com/someuser
  const extractUsernameFromUrl = (url: string): string | undefined => {
    if (!url) return undefined
    const m = url.match(/^https?:\/\/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/?(?:\?.*)?$/)
    if (m && m[1] !== 'intent') return m[1]
    return undefined
  }

  // Resolve the username: prefer explicit field, then extract from userLink
  const rawUsername = person.username || person.screenName || person.screen_name
  const urlUsername = extractUsernameFromUrl(person.userLink)
  const resolvedUsername = rawUsername || urlUsername

  const displayName = person.accountDisplayName || person.name || resolvedUsername || 'Unknown'
  const bio = person.bio || person.description || ''
  const profileImageUrl = person.profileImageUrl || null

  // Generate proper profile URL
  const getProfileUrl = () => {
    const link = person.userLink || ''
    if (link.startsWith('http://') || link.startsWith('https://')) return link
    if (person.accountId) return `https://twitter.com/intent/user?user_id=${person.accountId}`
    if (resolvedUsername) return `https://twitter.com/${resolvedUsername}`
    return '#'
  }

  const profileUrl = getProfileUrl()

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-800">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0 w-12 h-12">
          {profileImageUrl ? (
            <img
              src={profileImageUrl}
              alt={displayName}
              className="w-12 h-12 rounded-full object-cover absolute inset-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const fallback = e.currentTarget.nextElementSibling as HTMLElement
                if (fallback) fallback.style.display = 'flex'
              }}
            />
          ) : null}
          <div
            className={`${getAvatarColor(displayName)} w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold`}
            style={{ display: profileImageUrl ? 'none' : 'flex' }}
          >
            {getInitials(displayName)}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
              {displayName}
            </h3>
          </div>

          {resolvedUsername && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              @{resolvedUsername}
            </p>
          )}

          {bio && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">
              {bio.slice(0, 100)}
              {bio.length > 100 && '...'}
            </p>
          )}

          {/* Link to profile */}
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 mt-2"
          >
            View profile
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  )
}
