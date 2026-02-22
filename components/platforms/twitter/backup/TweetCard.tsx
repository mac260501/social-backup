'use client'

import Image from 'next/image'
import { TweetText } from './TweetText'

type TweetMediaItem = {
  type?: 'photo' | 'video' | 'animated_gif' | string
  media_url?: string
  media_url_https?: string
  url?: string
  video_info?: {
    variants?: Array<{
      url?: string
      content_type?: string
      bitrate?: number
    }>
  }
}

type TweetData = {
  id?: string
  id_str?: string
  tweet_url?: string
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
  in_reply_to_status_id_str?: string | null
  in_reply_to_user_id?: string | null
  in_reply_to_user_id_str?: string | null
  in_reply_to_screen_name?: string | null
  reply_count?: number
  retweet_count?: number
  favorite_count?: number
  is_pinned?: boolean
  pinned_rank?: number
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
  const rawText = tweet.full_text || tweet.text || ''
  const isRetweet = tweet.retweeted || rawText.startsWith('RT @')
  const replyTargetStatusId = tweet.in_reply_to_status_id || tweet.in_reply_to_status_id_str || null
  const replyTargetUserId = tweet.in_reply_to_user_id || tweet.in_reply_to_user_id_str || null
  const replyTargetScreenName = tweet.in_reply_to_screen_name || null
  const isReply = Boolean(replyTargetStatusId || replyTargetUserId || replyTargetScreenName)
  const replyTargetUrl =
    replyTargetStatusId && replyTargetScreenName
      ? `https://x.com/${replyTargetScreenName}/status/${replyTargetStatusId}`
      : null
  const isPinned = Boolean(tweet.is_pinned)

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
  const tweetId = tweet.id || tweet.id_str || ''

  const normalizeUrl = (value?: string) => {
    if (!value) return null
    return value.replace(/&amp;/g, '&').trim()
  }

  const isTcoUrl = (value?: string | null) => Boolean(value && /^https?:\/\/t\.co\//i.test(value))
  const isVideoUrl = (value?: string | null) => Boolean(value && /\.(mp4|webm|mov)(\?|$)/i.test(value))
  const deriveGifVideoFromThumb = (value?: string | null) => {
    if (!value) return null
    const match = value.match(/^https?:\/\/pbs\.twimg\.com\/tweet_video_thumb\/([^/?.]+)(?:\.[^/?]+)?/i)
    if (!match?.[1]) return null
    return `https://video.twimg.com/tweet_video/${match[1]}.mp4`
  }

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const attachmentShortUrls = new Set(
    media
      .map((mediaItem) => normalizeUrl(mediaItem.url))
      .filter((url): url is string => Boolean(url)),
  )

  const cleanedText =
    media.length > 0 && rawText
      ? Array.from(attachmentShortUrls).reduce((acc, shortUrl) => {
          const pattern = new RegExp(`(^|\\s)${escapeRegExp(shortUrl)}(?=\\s|$)`, 'g')
          return acc.replace(pattern, '$1')
        }, rawText)
          .replace(/\bhttps?:\/\/t\.co\/[A-Za-z0-9]+\b/g, '')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : rawText

  const text = media.length > 0 ? cleanedText : rawText
  const inferredTweetUrl = tweetId ? `https://x.com/${username}/status/${tweetId}` : null
  const tweetUrl = normalizeUrl(tweet.tweet_url) || inferredTweetUrl

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
            <Image
              key={profileImageUrl}
              src={profileImageUrl}
              alt={displayName}
              fill
              unoptimized
              sizes="48px"
              className="absolute inset-0 rounded-full object-cover"
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
              {formatDate(tweet.created_at || '')}
            </div>
          </div>

          {/* Badge for Retweet/Reply */}
          {isPinned && (
            <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18 2h-2.5a1 1 0 0 0-.8.4l-2.1 2.8a1 1 0 0 1-.8.4H8a2 2 0 0 0-2 2v4.2a2 2 0 0 0 .6 1.4l3.4 3.4V21a1 1 0 0 0 1.7.7l2.3-2.3a1 1 0 0 1 .7-.3H18a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
              </svg>
              <span>Pinned</span>
            </div>
          )}
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
              <span>
                Reply
                {replyTargetScreenName ? `ing to @${replyTargetScreenName}` : ''}
              </span>
              {replyTargetUrl ? (
                <a
                  href={replyTargetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-sky-400 hover:underline"
                >
                  View parent
                </a>
              ) : null}
            </div>
          )}

          {/* Tweet Text */}
          {text ? (
            <div className="mb-3 text-gray-900 dark:text-white">
              <TweetText text={text} />
            </div>
          ) : null}

          {/* Media Attachments */}
          {media && media.length > 0 && (
            <div className={`grid gap-2 mb-3 rounded-2xl overflow-hidden ${
              media.length === 1 ? 'grid-cols-1' :
              media.length === 2 ? 'grid-cols-2' :
              media.length === 3 ? 'grid-cols-2' :
              'grid-cols-2'
            }`}>
              {media.slice(0, 4).map((mediaItem, index: number) => (
                (() => {
                  const type = mediaItem.type
                  const previewUrl = normalizeUrl(mediaItem.media_url_https) || normalizeUrl(mediaItem.media_url)
                  const mediaUrl = normalizeUrl(mediaItem.media_url)
                  const directUrl = normalizeUrl(mediaItem.url)

                  const variants = Array.isArray(mediaItem.video_info?.variants) ? mediaItem.video_info?.variants || [] : []
                  const bestVariant = [...variants]
                    .filter((variant) => typeof variant.url === 'string' && `${variant.content_type || ''}`.toLowerCase().includes('mp4'))
                    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0]
                  const variantUrl = normalizeUrl(bestVariant?.url)
                  const derivedGifUrl = deriveGifVideoFromThumb(previewUrl)

                  const mediaSource =
                    type === 'photo'
                      ? (previewUrl || (!isTcoUrl(mediaUrl) ? mediaUrl : null) || (!isTcoUrl(directUrl) ? directUrl : null))
                      : (variantUrl || (isVideoUrl(mediaUrl) ? mediaUrl : null) || derivedGifUrl || (isVideoUrl(previewUrl) ? previewUrl : null))

                  return (
                    <div
                      key={index}
                      className={`relative ${
                        media.length === 3 && index === 0 ? 'col-span-2' : ''
                      }`}
                    >
                      {type === 'photo' && mediaSource ? (
                        <Image
                          src={mediaSource}
                          alt="Tweet media"
                          width={1200}
                          height={1200}
                          unoptimized
                          sizes="(max-width: 768px) 100vw, 50vw"
                          className="w-full h-auto max-h-96 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      ) : type === 'video' || type === 'animated_gif' ? (
                        <div className="relative">
                          {mediaSource ? (
                            <video
                              src={mediaSource}
                              poster={previewUrl || undefined}
                              controls
                              autoPlay={type === 'animated_gif'}
                              loop={type === 'animated_gif'}
                              muted={type === 'animated_gif'}
                              playsInline
                              className="w-full h-auto max-h-96 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget.nextElementSibling as HTMLImageElement | null
                                if (fallback) fallback.style.display = 'block'
                              }}
                            />
                          ) : null}
                          {previewUrl ? (
                            <Image
                              src={previewUrl}
                              alt="Tweet media"
                              width={1200}
                              height={1200}
                              unoptimized
                              sizes="(max-width: 768px) 100vw, 50vw"
                              className={`${mediaSource ? 'hidden' : 'block'} w-full h-auto max-h-96 rounded-lg border border-gray-200 object-cover dark:border-gray-700`}
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })()
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

            {tweetUrl && (
              <a
                href={tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-sky-400 hover:text-sky-300 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                View original
              </a>
            )}

            {/* Timestamp */}
            <div className="ml-auto text-sm">
              {formatTime(tweet.created_at || '')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
