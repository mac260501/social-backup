'use client'

import { TweetText } from './TweetText'

type TweetMediaItem = {
  type?: 'photo' | 'video' | 'animated_gif' | string
  media_url?: string
  url?: string
}

type TweetData = {
  author?: {
    username?: string
    name?: string
    profileImageUrl?: string
  }
  user?: {
    screen_name?: string
    name?: string
    profile_image_url_https?: string
    profile_image_url?: string
  }
  tweet?: {
    extended_entities?: {
      media?: TweetMediaItem[]
    }
    entities?: {
      media?: TweetMediaItem[]
    }
  }
  media?: TweetMediaItem[]
  extended_entities?: {
    media?: TweetMediaItem[]
  }
  entities?: {
    media?: TweetMediaItem[]
  }
  full_text?: string
  text?: string
  created_at?: string
  retweeted?: boolean
  in_reply_to_status_id?: string | null
  in_reply_to_user_id?: string | null
  reply_count?: number
  retweet_count?: number
  favorite_count?: number
}

interface TweetCardProps {
  tweet: TweetData
  ownerProfileImageUrl?: string | null
  ownerUsername?: string
  ownerDisplayName?: string
}

export function TweetCard({ tweet, ownerProfileImageUrl, ownerUsername, ownerDisplayName }: TweetCardProps) {
  // Parse both ISO format and Twitter archive format: "Thu Mar 10 12:00:00 +0000 2022"
  const parseDate = (dateString: string): Date => {
    if (!dateString) return new Date(NaN)
    const isoDate = new Date(dateString)
    if (!isNaN(isoDate.getTime())) return isoDate
    const m = dateString.match(/^(\w{3}) (\w{3}) (\d{2}) (\d{2}:\d{2}:\d{2}) \+0000 (\d{4})$/)
    if (m) {
      const [, dow, month, day, time, year] = m
      return new Date(`${dow}, ${day} ${month} ${year} ${time} +0000`)
    }
    return new Date(NaN)
  }

  const formatDate = (dateString: string) => {
    const date = parseDate(dateString)
    if (isNaN(date.getTime())) return ''
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatTime = (dateString: string) => {
    const date = parseDate(dateString)
    if (isNaN(date.getTime())) return ''
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  // Generate avatar color based on username
  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-blue-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-red-500',
      'bg-orange-500',
      'bg-yellow-500',
      'bg-green-500',
      'bg-teal-500',
      'bg-cyan-500',
      'bg-indigo-500',
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
    return name.substring(0, 2).toUpperCase()
  }

  const username = tweet.author?.username || tweet.user?.screen_name || ownerUsername || 'unknown'
  const displayName = tweet.author?.name || tweet.user?.name || ownerDisplayName || username
  const profileImageUrl = tweet.author?.profileImageUrl || tweet.user?.profile_image_url_https || tweet.user?.profile_image_url || ownerProfileImageUrl || null
  const text = tweet.full_text || tweet.text || ''
  const isRetweet = tweet.retweeted || text.startsWith('RT @')
  const isReply = tweet.in_reply_to_status_id || tweet.in_reply_to_user_id

  // Extract media from tweet (supports multiple Twitter data formats)
  const getMediaFromTweet = (): TweetMediaItem[] => {
    return (
      tweet.media ||
      tweet.extended_entities?.media ||
      tweet.entities?.media ||
      tweet.tweet?.extended_entities?.media ||
      tweet.tweet?.entities?.media ||
      []
    )
  }

  const media = getMediaFromTweet()

  return (
    <div className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0 relative w-12 h-12">
          <div
            className={`w-12 h-12 rounded-full ${getAvatarColor(displayName)} flex items-center justify-center text-white font-semibold`}
          >
            {getInitials(displayName)}
          </div>
          {profileImageUrl && (
            <img
              key={profileImageUrl}
              src={profileImageUrl}
              alt={displayName}
              className="absolute inset-0 w-12 h-12 rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>

        {/* Tweet Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="font-bold text-gray-900 dark:text-white truncate">
                {displayName}
              </span>
              <span className="text-gray-500 dark:text-gray-400 text-sm">
                @{username}
              </span>
            </div>
            <div className="text-gray-500 dark:text-gray-400 text-sm whitespace-nowrap">
              {formatDate(tweet.created_at)}
            </div>
          </div>

          {/* Badge for Retweet/Reply */}
          {isRetweet && (
            <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.77 15.67a.749.749 0 0 0-1.06 0l-2.22 2.22V7.65a3.755 3.755 0 0 0-3.75-3.75h-5.85a.75.75 0 0 0 0 1.5h5.85c1.24 0 2.25 1.01 2.25 2.25v10.24l-2.22-2.22a.749.749 0 1 0-1.06 1.06l3.5 3.5a.747.747 0 0 0 1.06 0l3.5-3.5a.749.749 0 0 0 0-1.06zm-10.66 3.28H7.26c-1.24 0-2.25-1.01-2.25-2.25V6.46l2.22 2.22a.752.752 0 0 0 1.062 0 .749.749 0 0 0 0-1.06l-3.5-3.5a.747.747 0 0 0-1.06 0l-3.5 3.5a.749.749 0 1 0 1.06 1.06l2.22-2.22V16.7a3.755 3.755 0 0 0 3.75 3.75h5.85a.75.75 0 0 0 0-1.5z" />
              </svg>
              <span>Retweeted</span>
            </div>
          )}
          {isReply && !isRetweet && (
            <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.046 2.242l-4.148-.01h-.002c-4.374 0-7.8 3.427-7.8 7.802 0 4.098 3.186 7.206 7.465 7.37v3.828a.85.85 0 0 0 .12.403.744.744 0 0 0 1.034.229c.264-.168 6.473-4.14 8.088-5.506 1.902-1.61 3.04-3.97 3.043-6.312v-.017c-.006-4.367-3.43-7.787-7.8-7.788zm3.787 12.972c-1.134.96-4.862 3.405-6.772 4.643V16.67a.75.75 0 0 0-.75-.75h-.396c-3.66 0-6.318-2.476-6.318-5.886 0-3.534 2.768-6.302 6.3-6.302l4.147.01h.002c3.532 0 6.3 2.766 6.302 6.296-.003 1.91-.942 3.844-2.514 5.176z" />
              </svg>
              <span>Reply</span>
            </div>
          )}

          {/* Tweet Text */}
          <div className="text-gray-900 dark:text-white mb-3">
            <TweetText text={text} />
          </div>

          {/* Media Attachments */}
          {media && media.length > 0 && (
            <div className={`grid gap-2 mb-3 rounded-2xl overflow-hidden ${
              media.length === 1 ? 'grid-cols-1' :
              media.length === 2 ? 'grid-cols-2' :
              media.length === 3 ? 'grid-cols-2' :
              'grid-cols-2'
            }`}>
              {media.slice(0, 4).map((mediaItem, index: number) => (
                <div
                  key={index}
                  className={`relative ${
                    media.length === 3 && index === 0 ? 'col-span-2' : ''
                  }`}
                >
                  {mediaItem.type === 'photo' ? (
                    <img
                      src={mediaItem.media_url || mediaItem.url}
                      alt="Tweet media"
                      className="w-full h-auto max-h-96 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                      onError={(e) => {
                        // Hide broken images
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : mediaItem.type === 'video' || mediaItem.type === 'animated_gif' ? (
                    <div className="relative">
                      <video
                        src={mediaItem.media_url || mediaItem.url}
                        controls
                        className="w-full h-auto max-h-96 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                        onError={(e) => {
                          // Hide broken videos
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Engagement Metrics */}
          <div className="flex items-center gap-6 text-gray-500 dark:text-gray-400">
            {/* Replies */}
            <div className="flex items-center gap-2 group">
              <svg className="w-5 h-5 group-hover:text-blue-500 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {tweet.reply_count !== undefined && tweet.reply_count > 0 && (
                <span className="text-sm">{tweet.reply_count.toLocaleString()}</span>
              )}
            </div>

            {/* Retweets */}
            <div className="flex items-center gap-2 group">
              <svg className="w-5 h-5 group-hover:text-green-500 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              {tweet.retweet_count !== undefined && tweet.retweet_count > 0 && (
                <span className="text-sm">{tweet.retweet_count.toLocaleString()}</span>
              )}
            </div>

            {/* Likes */}
            <div className="flex items-center gap-2 group">
              <svg className="w-5 h-5 group-hover:text-red-500 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {tweet.favorite_count !== undefined && tweet.favorite_count > 0 && (
                <span className="text-sm">{tweet.favorite_count.toLocaleString()}</span>
              )}
            </div>

            {/* Timestamp */}
            <div className="ml-auto text-sm">
              {formatTime(tweet.created_at)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
