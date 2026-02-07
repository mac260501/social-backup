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

  const displayName = person.accountDisplayName || person.userLink || 'Unknown'
  const handle = person.userLink || person.accountDisplayName || ''
  const bio = person.bio || ''
  const profileUrl = handle.startsWith('@')
    ? `https://twitter.com/${handle.slice(1)}`
    : `https://twitter.com/${handle}`

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-800">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`${getAvatarColor(displayName)} w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}
        >
          {getInitials(displayName)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
              {displayName}
            </h3>
          </div>

          {handle && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {handle.startsWith('@') ? handle : `@${handle}`}
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
