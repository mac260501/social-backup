'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TweetCard } from '@/components/platforms/twitter/backup/TweetCard'

interface BackupViewerProps {
  backup: BackupRecord
}

type Tab = 'posts' | 'replies' | 'media'
type ProfileMediaItem = {
  id: string
  url: string
  fallbackImageUrl?: string
  type: 'photo' | 'video' | 'animated_gif'
  variantUrls?: string[]
  tweetUrl?: string
  tweetText: string
  createdAt?: string
  likes: number
  replies: number
  reposts: number
  views: number
}
type PeopleTab = 'followers' | 'following'
type ViewMode = 'profile' | 'chat'
type ChatMessage = {
  text: string
  senderId: string
  recipientId: string
  createdAt: string
  media?: unknown[]
}
type ChatConversation = {
  id: string
  participantId: string
  participantName: string
  profileUrl: string
  messages: ChatMessage[]
  lastMessageDate: string
}

interface BackupProfile {
  displayName?: string
  name?: string
  username?: string
  description?: string
  profileImageUrl?: string
  profile_image_url_https?: string
  profile_image_url?: string
  coverImageUrl?: string
  bannerImageUrl?: string
  profile_banner_url?: string
  followersCount?: number | string
  followingCount?: number | string
  followers_count?: number | string
  following_count?: number | string
  followers?: number | string
  following?: number | string
}

type SnapshotScrapeTargets = {
  profile: boolean
  tweets: boolean
  replies: boolean
  followers: boolean
  following: boolean
}

interface BackupData {
  profile?: BackupProfile
  stats?: Record<string, number | string>
  tweets?: unknown[]
  replies?: unknown[]
  followers?: unknown[]
  following?: unknown[]
  dms?: unknown[]
  direct_messages?: unknown[]
  scrape?: {
    targets?: Partial<SnapshotScrapeTargets>
  }
}

interface BackupRecord {
  id: string
  data?: BackupData
  stats?: Record<string, number | string>
  uploaded_at?: string
  created_at?: string
  backup_type?: string
  source?: string
  backup_source?: string
  archive_file_path?: string
  user_id?: string
  userId?: string
}

function getStringAtPath(source: unknown, path: string[]): string | null {
  let current: unknown = source
  for (const key of path) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null
}

function normalizeImageUrl(value: string | null) {
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('/')) {
    return value
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return null
  return `${supabaseUrl}/storage/v1/object/public/twitter-media/${value.replace(/^\/+/, '')}`
}

function decodeMediaUrl(url: string) {
  return url.replace(/&amp;/g, '&')
}

function isGifUrl(url?: string | null) {
  if (!url) return false
  return /\.gif($|\?)/i.test(url)
}

function isTcoUrl(url?: string | null) {
  if (!url) return false
  return /^https?:\/\/t\.co\//i.test(url)
}

function isLikelyVideoUrl(url?: string | null) {
  if (!url) return false
  return /\.(mp4|webm|mov|m3u8)($|\?)/i.test(url)
}

function deriveGifVideoUrl(url?: string | null) {
  if (!url) return null
  const match = url.match(/^https?:\/\/pbs\.twimg\.com\/tweet_video_thumb\/([^/?.]+)(?:\.[^/?]+)?/i)
  if (!match?.[1]) return null
  return `https://video.twimg.com/tweet_video/${match[1]}.mp4`
}

function stripMediaAttachmentLinks(text: string, mediaShortUrls: string[]) {
  if (!text) return ''
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return mediaShortUrls
    .reduce((acc, shortUrl) => {
      if (!shortUrl) return acc
      const pattern = new RegExp(`(^|\\s)${escapeRegExp(shortUrl)}(?=\\s|$)`, 'g')
      return acc.replace(pattern, '$1')
    }, text)
    .replace(/\bhttps?:\/\/t\.co\/[A-Za-z0-9]+\b/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractUsernameFromUrl(url?: string) {
  if (!url) return ''
  const m = url.match(/^https?:\/\/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/?(?:\?.*)?$/)
  return m?.[1] || ''
}

function extractUserIdFromIntentUrl(url?: string) {
  if (!url) return ''
  const m = url.match(/[?&]user_id=(\d+)/)
  return m?.[1] || ''
}

function parseSnapshotTargets(value: unknown): SnapshotScrapeTargets | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const keys: Array<keyof SnapshotScrapeTargets> = ['profile', 'tweets', 'replies', 'followers', 'following']
  const hasAnyKey = keys.some((key) => key in source)
  if (!hasAnyKey) return null

  return {
    profile: Boolean(source.profile),
    tweets: Boolean(source.tweets),
    replies: Boolean(source.replies),
    followers: Boolean(source.followers),
    following: Boolean(source.following),
  }
}

function getTweetDedupeKey(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const tweet = item as Record<string, unknown>
  if (typeof tweet.id === 'string' && tweet.id.trim().length > 0) return tweet.id
  if (typeof tweet.id === 'number') return String(tweet.id)
  if (typeof tweet.id_str === 'string' && tweet.id_str.trim().length > 0) return tweet.id_str

  const createdAt = typeof tweet.created_at === 'string' ? tweet.created_at : ''
  const text = typeof tweet.text === 'string' ? tweet.text : ''
  const url = typeof tweet.tweet_url === 'string' ? tweet.tweet_url : ''
  const composite = `${createdAt}|${text}|${url}`.trim()
  return composite.length > 0 ? composite : null
}

function dedupeTweetItems(items: unknown[]): unknown[] {
  const seen = new Set<string>()
  const deduped: unknown[] = []

  for (const item of items) {
    const key = getTweetDedupeKey(item)
    if (!key) {
      deduped.push(item)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped
}

export function BackupViewer({ backup }: BackupViewerProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('posts')
  const [isDownloading, setIsDownloading] = useState(false)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null)
  const [selectedMediaVideoError, setSelectedMediaVideoError] = useState(false)
  const [selectedMediaVariantIndex, setSelectedMediaVariantIndex] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('profile')
  const [chatSearch, setChatSearch] = useState('')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [peopleViewOpen, setPeopleViewOpen] = useState(false)
  const [activePeopleTab, setActivePeopleTab] = useState<PeopleTab>('following')
  const profile = backup.data?.profile
  const tweetList = useMemo(
    () => dedupeTweetItems(Array.isArray(backup.data?.tweets) ? backup.data.tweets : []),
    [backup.data?.tweets],
  )

  const firstTweetWithAvatar = useMemo(
    () =>
      tweetList.find((tweet) => {
        const t = tweet as Record<string, unknown>
        const author = t.author as Record<string, unknown> | undefined
        const user = t.user as Record<string, unknown> | undefined
        return Boolean(
          (author && typeof author.profileImageUrl === 'string' && author.profileImageUrl) ||
            (user && typeof user.profile_image_url_https === 'string' && user.profile_image_url_https) ||
            (user && typeof user.profile_image_url === 'string' && user.profile_image_url)
        )
      }) as Record<string, unknown> | undefined,
    [tweetList]
  )

  const avatarCandidate = useMemo(
    () =>
      profile?.profileImageUrl ||
      profile?.profile_image_url_https ||
      profile?.profile_image_url ||
      getStringAtPath(backup, ['data', 'profileImageUrl']) ||
      getStringAtPath(backup, ['data', 'accountProfile', 'avatarMediaUrl']) ||
      getStringAtPath(firstTweetWithAvatar, ['author', 'profileImageUrl']) ||
      getStringAtPath(firstTweetWithAvatar, ['user', 'profile_image_url_https']) ||
      getStringAtPath(firstTweetWithAvatar, ['user', 'profile_image_url']),
    [backup, firstTweetWithAvatar, profile?.profileImageUrl, profile?.profile_image_url, profile?.profile_image_url_https]
  )

  const coverCandidate = useMemo(
    () =>
      profile?.coverImageUrl ||
      profile?.bannerImageUrl ||
      profile?.profile_banner_url ||
      getStringAtPath(backup, ['data', 'coverImageUrl']) ||
      getStringAtPath(backup, ['data', 'accountProfile', 'headerMediaUrl']),
    [backup, profile?.bannerImageUrl, profile?.coverImageUrl, profile?.profile_banner_url]
  )

  useEffect(() => {
    const normalizedAvatar = normalizeImageUrl(avatarCandidate)
    const normalizedCover = normalizeImageUrl(coverCandidate)

    if (normalizedAvatar) setProfileImageUrl(normalizedAvatar)
    if (normalizedCover) setCoverImageUrl(normalizedCover)

    fetch(`/api/platforms/twitter/profile-media?backupId=${backup.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const signedAvatar = normalizeImageUrl(data.profileImageUrl || null)
          const signedCover = normalizeImageUrl(data.coverImageUrl || null)
          if (signedAvatar) setProfileImageUrl(signedAvatar)
          if (signedCover) setCoverImageUrl(signedCover)
        }
      })
      .catch(() => {
        // CDN fallback already applied above.
      })
  }, [avatarCandidate, backup.id, coverCandidate])

  const handleDownloadArchive = async () => {
    try {
      setIsDownloading(true)
      const response = await fetch(`/api/platforms/twitter/download-archive?backupId=${backup.id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to download archive')
      }

      if (data.success && data.downloadUrl) {
        window.location.href = data.downloadUrl
      }
    } catch (error) {
      console.error('Error downloading archive:', error)
      alert(error instanceof Error ? error.message : 'Failed to download archive')
    } finally {
      setIsDownloading(false)
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown date'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const numberValue = (value: unknown, fallback = 0) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    return fallback
  }

  const optionalNumberValue = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  const stats = backup.stats || backup.data?.stats || {}
  const tweets = tweetList
  const replies = useMemo(
    () => dedupeTweetItems(Array.isArray(backup.data?.replies) ? backup.data.replies : []),
    [backup.data?.replies],
  )
  const followers = useMemo(() => (Array.isArray(backup.data?.followers) ? backup.data.followers : []), [backup.data?.followers])
  const following = useMemo(() => (Array.isArray(backup.data?.following) ? backup.data.following : []), [backup.data?.following])
  const dms = useMemo(() => backup.data?.dms || backup.data?.direct_messages || [], [backup.data?.dms, backup.data?.direct_messages])

  const displayName =
    backup.data?.profile?.displayName || backup.data?.profile?.name || backup.data?.profile?.username || 'Archived Account'
  const username = backup.data?.profile?.username || 'unknown'
  const profileBio = backup.data?.profile?.description || 'Archived profile from Social Backup.'

  const createdAt = backup.uploaded_at || backup.created_at
  const isArchiveBackup =
    backup.backup_type === 'full_archive' ||
    backup.source === 'archive' ||
    backup.backup_source === 'archive_upload' ||
    Boolean(backup.archive_file_path)
  const scrapeTargets = parseSnapshotTargets(backup.data?.scrape?.targets)
  const hasSnapshotTargetConfig = !isArchiveBackup && !!scrapeTargets

  const postsIncluded = isArchiveBackup ? true : hasSnapshotTargetConfig ? Boolean(scrapeTargets?.tweets) : true
  const repliesIncluded = isArchiveBackup ? true : hasSnapshotTargetConfig ? Boolean(scrapeTargets?.replies) : true
  const followersIncluded = isArchiveBackup ? true : hasSnapshotTargetConfig ? Boolean(scrapeTargets?.followers) : true
  const followingIncluded = isArchiveBackup ? true : hasSnapshotTargetConfig ? Boolean(scrapeTargets?.following) : true
  const mediaIncluded = isArchiveBackup ? true : hasSnapshotTargetConfig ? Boolean(scrapeTargets?.tweets || scrapeTargets?.replies) : true
  const chatsIncluded = isArchiveBackup

  const profileFollowersCount =
    optionalNumberValue(profile?.followersCount) ??
    optionalNumberValue(profile?.followers_count) ??
    optionalNumberValue(profile?.followers)
  const profileFollowingCount =
    optionalNumberValue(profile?.followingCount) ??
    optionalNumberValue(profile?.following_count) ??
    optionalNumberValue(profile?.following)

  const tweetCount = numberValue(stats.tweets, tweets.length)
  const mediaCount = numberValue(stats.media_files)
  const dmCount = numberValue(stats.dms, dms.length)
  const followersListCount = numberValue(stats.followers, followers.length)
  const followingListCount = numberValue(stats.following, following.length)
  const followersRetrievedCount = followers.length
  const followingRetrievedCount = following.length
  const followersCount = followersIncluded
    ? Math.max(followersListCount, profileFollowersCount || 0)
    : profileFollowersCount
  const followingCount = followingIncluded
    ? Math.max(followingListCount, profileFollowingCount || 0)
    : profileFollowingCount
  const missingFollowersCount =
    followersIncluded && followersCount !== null
      ? Math.max(0, followersCount - followersRetrievedCount)
      : 0
  const missingFollowingCount =
    followingIncluded && followingCount !== null
      ? Math.max(0, followingCount - followingRetrievedCount)
      : 0

  const methodLabel = useMemo(() => {
    if (isArchiveBackup) return `Archive Backup @${username}`
    return `Snapshot @${username}`
  }, [isArchiveBackup, username])

  const postItems = tweets
  const replyItems =
    replies.length > 0
      ? replies
      : tweets.filter((tweet) => {
          const t = tweet as Record<string, unknown>
          return Boolean(t.in_reply_to_status_id || t.in_reply_to_user_id || t.in_reply_to_screen_name)
        })
  const timelineMediaSource = useMemo(
    () => (replies.length > 0 ? [...tweets, ...replies] : tweets),
    [replies, tweets],
  )
  const replyCount = numberValue(stats.replies, replyItems.length)
  const formatCount = (value: number | null) => (value === null ? 'N/A' : value.toLocaleString())

  const profileMediaItems = useMemo(() => {
    const items: ProfileMediaItem[] = []
    const seen = new Set<string>()

    for (let i = 0; i < timelineMediaSource.length; i += 1) {
      const tweet = timelineMediaSource[i] as Record<string, unknown>
      const media =
        (tweet.media as Record<string, unknown>[] | undefined) ||
        ((tweet.extended_entities as Record<string, unknown> | undefined)?.media as Record<string, unknown>[] | undefined) ||
        ((tweet.entities as Record<string, unknown> | undefined)?.media as Record<string, unknown>[] | undefined) ||
        (((tweet.tweet as Record<string, unknown> | undefined)?.extended_entities as Record<string, unknown> | undefined)?.media as
          | Record<string, unknown>[]
          | undefined) ||
        (((tweet.tweet as Record<string, unknown> | undefined)?.entities as Record<string, unknown> | undefined)?.media as
          | Record<string, unknown>[]
          | undefined) ||
        []

      media.forEach((mediaItem, mediaIndex) => {
        const rawType = mediaItem.type
        const type: ProfileMediaItem['type'] =
          rawType === 'video' || rawType === 'animated_gif' ? (rawType as ProfileMediaItem['type']) : 'photo'

        const mediaUrlHttpsRaw = mediaItem.media_url_https as string | undefined
        const mediaUrlRawValue = mediaItem.media_url as string | undefined
        const fallbackImageUrlRaw = mediaUrlHttpsRaw || mediaUrlRawValue
        const fallbackImageUrl = fallbackImageUrlRaw ? decodeMediaUrl(fallbackImageUrlRaw) : undefined

        const normalizedMediaUrl = mediaUrlRawValue ? decodeMediaUrl(mediaUrlRawValue) : undefined
        const normalizedMediaUrlHttps = mediaUrlHttpsRaw ? decodeMediaUrl(mediaUrlHttpsRaw) : undefined
        const normalizedShortUrl = typeof mediaItem.url === 'string' ? decodeMediaUrl(mediaItem.url) : undefined
        const derivedGifVideo = type === 'animated_gif' ? deriveGifVideoUrl(normalizedMediaUrlHttps || normalizedMediaUrl) : null

        let mediaUrlRaw =
          (type === 'photo'
            ? normalizedMediaUrlHttps || normalizedMediaUrl
            : (isLikelyVideoUrl(normalizedMediaUrl) ? normalizedMediaUrl : null) ||
              (isLikelyVideoUrl(normalizedMediaUrlHttps) ? normalizedMediaUrlHttps : null) ||
              derivedGifVideo ||
              (!isTcoUrl(normalizedShortUrl) ? normalizedShortUrl : null)) ||
          ''

        let variantUrls: string[] | undefined

        if ((type === 'video' || type === 'animated_gif') && mediaItem.video_info) {
          const variants = (mediaItem.video_info as Record<string, unknown>).variants as Record<string, unknown>[] | undefined
          const mp4Variants = (variants || []).filter(
            (v) => typeof v.url === 'string' && `${v.content_type || ''}`.toLowerCase().includes('mp4')
          )
          const sortedVariants = mp4Variants
            .sort((a, b) => Number((b.bitrate as number | undefined) || 0) - Number((a.bitrate as number | undefined) || 0))
            .map((v) => (typeof v.url === 'string' ? decodeMediaUrl(v.url) : ''))
            .filter(Boolean)
          variantUrls = sortedVariants.length > 0 ? sortedVariants : undefined
          const bestVariant = sortedVariants[0]
          if (bestVariant) {
            mediaUrlRaw = bestVariant
          }
          if (type === 'animated_gif') {
            const gifSource = fallbackImageUrlRaw ? decodeMediaUrl(fallbackImageUrlRaw) : null
            if (gifSource && isGifUrl(gifSource)) {
              variantUrls = [gifSource, ...(variantUrls || [])]
              if (!bestVariant) mediaUrlRaw = gifSource
            }
          }
        }

        const mediaUrl = mediaUrlRaw ? decodeMediaUrl(mediaUrlRaw) : ''

        const rawTweetText =
          (tweet.full_text as string | undefined) ||
          (tweet.text as string | undefined) ||
          (((tweet.tweet as Record<string, unknown> | undefined)?.full_text as string | undefined) ||
            ((tweet.tweet as Record<string, unknown> | undefined)?.text as string | undefined)) ||
          ''
        const text = stripMediaAttachmentLinks(rawTweetText, [
          normalizedShortUrl || '',
          typeof mediaItem.url === 'string' ? mediaItem.url : '',
        ])
        const tweetId =
          (tweet.id as string | undefined) ||
          (tweet.id_str as string | undefined) ||
          ((tweet.tweet as Record<string, unknown> | undefined)?.id_str as string | undefined) ||
          ((tweet.tweet as Record<string, unknown> | undefined)?.id as string | undefined)
        const authorUsername =
          ((tweet.author as Record<string, unknown> | undefined)?.username as string | undefined) ||
          ((tweet.user as Record<string, unknown> | undefined)?.screen_name as string | undefined) ||
          username
        const tweetUrl =
          (tweet.tweet_url as string | undefined) ||
          (tweetId && authorUsername ? `https://x.com/${authorUsername}/status/${tweetId}` : undefined)

        if (!mediaUrl || seen.has(mediaUrl)) return
        seen.add(mediaUrl)
        items.push({
          id: `${i}-${mediaIndex}-${mediaUrl}`,
          url: mediaUrl,
          fallbackImageUrl,
          variantUrls,
          type,
          tweetUrl,
          tweetText: text,
          createdAt: (tweet.created_at as string | undefined) || ((tweet.tweet as Record<string, unknown> | undefined)?.created_at as string | undefined),
          likes: numberValue(tweet.favorite_count, 0),
          replies: numberValue(tweet.reply_count, 0),
          reposts: numberValue(tweet.retweet_count, 0),
          views: numberValue(tweet.view_count, numberValue(tweet.views, 0)),
        })
      })
    }

    return items
  }, [timelineMediaSource, username])

  const tabs = [
    { id: 'posts' as Tab, label: 'Posts' },
    { id: 'replies' as Tab, label: 'Replies' },
    { id: 'media' as Tab, label: 'Media' },
  ]

  const followersList = followers
  const followingList = following
  const currentPeopleList = activePeopleTab === 'followers' ? followersList : followingList
  const activePeopleTabIncluded = activePeopleTab === 'followers' ? followersIncluded : followingIncluded

  const normalizedDmList = useMemo(() => {
    if (Array.isArray(dms)) return dms
    if (dms && typeof dms === 'object') {
      const dmObj = dms as Record<string, unknown>
      if (Array.isArray(dmObj.dmConversations)) return dmObj.dmConversations
      if (Array.isArray(dmObj.conversations)) return dmObj.conversations
      return Object.values(dmObj)
    }
    return []
  }, [dms])

  const ownerDmId = useMemo(() => {
    const frequency = new Map<string, number>()

    normalizedDmList.forEach((entry) => {
      const item = entry as Record<string, unknown>
      const conversationId =
        (item.conversation_id as string | undefined) ||
        (item.conversationId as string | undefined) ||
        (item.dmConversationId as string | undefined) ||
        ''

      if (conversationId.includes('-')) {
        conversationId.split('-').forEach((part) => {
          if (!part) return
          frequency.set(part, (frequency.get(part) || 0) + 1)
        })
      }
    })

    if (frequency.size > 0) {
      return Array.from(frequency.entries()).sort((a, b) => b[1] - a[1])[0][0]
    }

    return String(backup.user_id || '')
  }, [backup.user_id, normalizedDmList])

  const dmConversations = useMemo<ChatConversation[]>(() => {
    const map = new Map<string, ChatConversation>()

    normalizedDmList.forEach((entry) => {
      const item = entry as Record<string, unknown>
      const conversationId =
        (item.conversation_id as string | undefined) ||
        (item.conversationId as string | undefined) ||
        (item.dmConversationId as string | undefined) ||
        (item.id as string | undefined) ||
        `conversation-${Math.random()}`
      const messagesRaw = Array.isArray(item.messages) ? item.messages : [item]

      if (!map.has(conversationId)) {
        const parts = conversationId.includes('-') ? conversationId.split('-') : []
        const participantIdGuess = parts.find((part) => part !== ownerDmId) || parts[0] || 'unknown'
        const participantName = participantIdGuess !== 'unknown' ? `User ${participantIdGuess}` : 'Unknown'
        map.set(conversationId, {
          id: conversationId,
          participantId: participantIdGuess,
          participantName,
          profileUrl:
            participantIdGuess !== 'unknown'
              ? `https://twitter.com/intent/user?user_id=${participantIdGuess}`
              : '#',
          messages: [],
          lastMessageDate: '',
        })
      }

      const conversation = map.get(conversationId)!

      messagesRaw.forEach((messageItem) => {
        const msg = messageItem as Record<string, unknown>
        const messageData = (msg.messageCreate as Record<string, unknown> | undefined) || msg
        const senderId = String(
          messageData.sender_id ||
            messageData.senderId ||
            msg.sender_id ||
            msg.senderId ||
            ''
        )
        const recipientId = String(
          messageData.recipient_id ||
            messageData.recipientId ||
            msg.recipient_id ||
            msg.recipientId ||
            ''
        )
        const createdAt = String(
          messageData.created_at ||
            messageData.createdAt ||
            msg.created_at ||
            msg.createdAt ||
            new Date().toISOString()
        )
        const text = String(
          messageData.text ||
            messageData.messageText ||
            messageData.content ||
            msg.text ||
            msg.content ||
            ''
        )

        conversation.messages.push({
          text,
          senderId,
          recipientId,
          createdAt,
          media: (messageData.media as unknown[]) || (msg.media as unknown[]) || [],
        })

        if (senderId && senderId !== ownerDmId) {
          conversation.participantId = senderId
          conversation.participantName = `User ${senderId}`
          conversation.profileUrl = `https://twitter.com/intent/user?user_id=${senderId}`
        } else if (recipientId && recipientId !== ownerDmId) {
          conversation.participantId = recipientId
          conversation.participantName = `User ${recipientId}`
          conversation.profileUrl = `https://twitter.com/intent/user?user_id=${recipientId}`
        }
      })
    })

    return Array.from(map.values())
      .map((conversation) => {
        conversation.messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        conversation.lastMessageDate = conversation.messages[conversation.messages.length - 1]?.createdAt || ''
        return conversation
      })
      .sort((a, b) => new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime())
  }, [normalizedDmList, ownerDmId])

  const filteredDmConversations = useMemo(() => {
    if (!chatSearch.trim()) return dmConversations
    const query = chatSearch.toLowerCase()
    return dmConversations.filter(
      (conversation) =>
        conversation.participantName.toLowerCase().includes(query) ||
        conversation.participantId.toLowerCase().includes(query) ||
        conversation.messages.some((m) => m.text.toLowerCase().includes(query))
    )
  }, [chatSearch, dmConversations])

  const selectedConversation = useMemo(
    () => filteredDmConversations.find((conversation) => conversation.id === selectedConversationId) || filteredDmConversations[0] || null,
    [filteredDmConversations, selectedConversationId]
  )

  useEffect(() => {
    if (viewMode !== 'chat') return
    if (!selectedConversationId && filteredDmConversations.length > 0) {
      setSelectedConversationId(filteredDmConversations[0].id)
    }
  }, [filteredDmConversations, selectedConversationId, viewMode])

  const openPeople = (tab: PeopleTab) => {
    setActivePeopleTab(tab)
    setPeopleViewOpen(true)
  }

  const personDisplay = (person: unknown) => {
    const p = person as Record<string, unknown>
    const followerObj = (p.follower as Record<string, unknown> | undefined) || {}
    const followingObj = (p.following as Record<string, unknown> | undefined) || {}

    const userId =
      (p.user_id as string | undefined) ||
      (p.userId as string | undefined) ||
      (p.accountId as string | undefined) ||
      (followerObj.accountId as string | undefined) ||
      (followingObj.accountId as string | undefined) ||
      extractUserIdFromIntentUrl((p.userLink as string | undefined) || (followerObj.userLink as string | undefined) || (followingObj.userLink as string | undefined))

    const rawUserLink =
      (p.userLink as string | undefined) ||
      (followerObj.userLink as string | undefined) ||
      (followingObj.userLink as string | undefined) ||
      (userId ? `https://twitter.com/intent/user?user_id=${userId}` : '')

    const name =
      (p.accountDisplayName as string | undefined) ||
      (p.name as string | undefined) ||
      (followerObj.name as string | undefined) ||
      (followingObj.name as string | undefined) ||
      (p.displayName as string | undefined) ||
      (userId ? `User ${userId}` : 'Unknown')
    const username =
      (p.username as string | undefined) ||
      (p.screen_name as string | undefined) ||
      (p.screenName as string | undefined) ||
      (followerObj.username as string | undefined) ||
      (followingObj.username as string | undefined) ||
      extractUsernameFromUrl(rawUserLink)
    const bio = (p.bio as string | undefined) || (p.description as string | undefined) || ''
    const avatar = (p.profileImageUrl as string | undefined) || (p.profile_image_url_https as string | undefined) || null
    const profileUrl = username ? `https://x.com/${username}` : userId ? `https://twitter.com/intent/user?user_id=${userId}` : '#'
    return { name, username, bio, avatar, userId, profileUrl }
  }

  const selectedMedia = selectedMediaIndex !== null ? profileMediaItems[selectedMediaIndex] : null
  const selectedMediaUrl =
    selectedMedia && selectedMedia.variantUrls && selectedMedia.variantUrls.length > 0
      ? selectedMedia.variantUrls[Math.min(selectedMediaVariantIndex, selectedMedia.variantUrls.length - 1)]
      : selectedMedia?.url || null

  useEffect(() => {
    setSelectedMediaVideoError(false)
    setSelectedMediaVariantIndex(0)
  }, [selectedMediaIndex])

  useEffect(() => {
    if (selectedMediaIndex === null) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedMediaIndex(null)
      if (event.key === 'ArrowRight') {
        setSelectedMediaIndex((prev) => (prev === null ? prev : Math.min(prev + 1, profileMediaItems.length - 1)))
      }
      if (event.key === 'ArrowLeft') {
        setSelectedMediaIndex((prev) => (prev === null ? prev : Math.max(prev - 1, 0)))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [profileMediaItems.length, selectedMediaIndex])

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-[1440px] px-0 sm:px-4">
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[86px_minmax(0,1fr)] xl:grid-cols-[275px_minmax(0,620px)_360px]">
          <aside className="hidden border-r border-white/10 p-3 md:block xl:p-5">
            <div className="sticky top-3 space-y-4 xl:top-5">
              <div className="flex items-center xl:justify-start">
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="rounded-full px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  title="Back to backups"
                >
                  ← Back to all backups
                </button>
              </div>

              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => setViewMode('chat')}
                  className={`flex w-full items-center gap-3 rounded-full px-4 py-3 text-[15px] font-medium text-white transition hover:bg-white/10 ${
                    viewMode === 'chat' ? 'bg-white/10' : ''
                  }`}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h8M8 14h5m8 6l-4.35-3.26A2 2 0 0015.45 16H7a3 3 0 01-3-3V7a3 3 0 013-3h10a3 3 0 013 3v7a3 3 0 01-3 3h-1.55a2 2 0 00-1.2.74L10 20z" />
                  </svg>
                  Chat
                </button>
              </div>
            </div>
          </aside>

          <main className={`min-w-0 border-r border-white/10 ${viewMode === 'chat' ? 'xl:col-span-2' : ''}`}>
            {viewMode === 'chat' ? (
              <div className="grid h-screen grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="border-r border-white/10">
                  <div className="border-b border-white/10 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-3xl font-bold">Chat</h2>
                      <button
                        type="button"
                        onClick={() => setViewMode('profile')}
                        className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
                      >
                        Back
                      </button>
                    </div>
                    <input
                      type="text"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder={chatsIncluded ? 'Search' : 'Not available for this snapshot'}
                      disabled={!chatsIncluded}
                      className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div className="overflow-y-auto">
                    {!chatsIncluded ? (
                      <div className="p-6 text-center text-gray-400">
                        Direct messages are not included in snapshots.
                      </div>
                    ) : filteredDmConversations.length > 0 ? (
                      filteredDmConversations.map((conversation) => {
                        const lastMessage = conversation.messages[conversation.messages.length - 1]
                        return (
                          <button
                            key={conversation.id}
                            type="button"
                            onClick={() => setSelectedConversationId(conversation.id)}
                            className={`w-full border-b border-white/10 px-4 py-4 text-left transition hover:bg-white/5 ${
                              selectedConversation?.id === conversation.id ? 'bg-white/10' : ''
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="h-12 w-12 flex-shrink-0 rounded-full bg-gray-700" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="truncate text-lg font-semibold text-white">{conversation.participantName}</p>
                                  <span className="text-xs text-gray-500">
                                    {lastMessage?.createdAt
                                      ? new Date(lastMessage.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                      : ''}
                                  </span>
                                </div>
                                <p className="truncate text-sm text-gray-400">id:{conversation.participantId}</p>
                                <p className="mt-1 truncate text-sm text-gray-500">{lastMessage?.text || 'Media'}</p>
                              </div>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <div className="p-6 text-center text-gray-500">No conversations found.</div>
                    )}
                  </div>
                </aside>

                <section className="flex min-h-0 flex-col">
                  {!chatsIncluded ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-gray-400">
                      This snapshot does not include chats.
                    </div>
                  ) : selectedConversation ? (
                    <>
                      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                        <a
                          href={selectedConversation.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xl font-semibold text-white hover:underline"
                        >
                          {selectedConversation.participantName}
                        </a>
                        <button type="button" className="rounded-full p-2 hover:bg-white/10">
                          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
                          </svg>
                        </button>
                      </header>

                      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
                        {selectedConversation.messages.map((message, index) => {
                          const isFromUser = message.senderId === ownerDmId
                          return (
                            <div key={`${selectedConversation.id}-${index}`} className={`flex ${isFromUser ? 'justify-end' : 'justify-start'}`}>
                              <div
                                className={`max-w-[78%] rounded-3xl px-4 py-2 text-base leading-6 ${
                                  isFromUser ? 'bg-sky-500 text-white' : 'bg-[#1b1f2a] text-gray-100'
                                }`}
                              >
                                <p className="whitespace-pre-wrap break-words">{message.text || '[media]'}</p>
                                <p className={`mt-1 text-xs ${isFromUser ? 'text-sky-100' : 'text-gray-400'}`}>
                                  {new Date(message.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <footer className="border-t border-white/10 px-4 py-3">
                        <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-gray-500">Unencrypted message</div>
                      </footer>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-500">Select a conversation to start reading.</div>
                  )}
                </section>
              </div>
            ) : (
            <>
            <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 px-4 py-2 backdrop-blur sm:px-5">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => router.push('/dashboard/backups')}
                  className="rounded-full p-1.5 text-lg hover:bg-white/10 md:hidden"
                  title="Back"
                >
                  ←
                </button>
                <div>
                  <p className="text-base font-bold sm:text-lg">{displayName}</p>
                  <p className="text-xs text-gray-400">
                    {postsIncluded
                      ? `${tweetCount.toLocaleString()} posts in backup`
                      : 'Posts were not included in this snapshot'}
                  </p>
                </div>
              </div>
            </header>

            <div className="relative h-[190px] bg-gray-900 sm:h-[210px]">
              {coverImageUrl ? (
                <img src={coverImageUrl} alt="Cover" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-gradient-to-r from-blue-500 to-sky-600" />
              )}
            </div>

            <section className="relative z-10 px-4 pb-3 pt-3 sm:px-5">
              <div className="-mt-[68px] mb-3 flex items-end justify-between">
                <div className="relative z-20 h-[134px] w-[134px] overflow-hidden rounded-full border-4 border-black bg-gray-800">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" />
                  )}
                </div>
              </div>

              <h1 className="text-xl font-extrabold sm:text-2xl">{displayName}</h1>
              <p className="text-sm text-gray-400">@{username}</p>
              <p className="mt-2 max-w-2xl text-sm text-gray-300">{profileBio}</p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400">
                <button
                  type="button"
                  onClick={() => openPeople('following')}
                  className="transition hover:text-white"
                >
                  <strong className="font-semibold text-white">{formatCount(followingCount)}</strong> Following
                </button>
                <button
                  type="button"
                  onClick={() => openPeople('followers')}
                  className="transition hover:text-white"
                >
                  <strong className="font-semibold text-white">{formatCount(followersCount)}</strong> Followers
                </button>
              </div>
              <div className="mt-2 text-sm text-gray-400">Captured {formatDate(createdAt)}</div>
            </section>

            <div className="sticky top-[52px] z-10 border-y border-white/10 bg-black/95 backdrop-blur">
              <div className="grid grid-cols-3">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`group relative px-4 py-4 text-sm font-semibold leading-none transition ${
                      activeTab === tab.id
                        ? 'text-white'
                        : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                    }`}
                  >
                    <span className="align-middle leading-none">{tab.label}</span>
                    <span
                      className={`absolute bottom-0 left-1/2 h-1 w-[64px] -translate-x-1/2 rounded-full bg-sky-500 transition-opacity ${
                        activeTab === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <section>
              {activeTab === 'posts' && (
                <div className="divide-y divide-white/10">
                  {!postsIncluded ? (
                    <div className="p-10 text-center text-gray-400">Posts were not included in this snapshot.</div>
                  ) : postItems.length > 0 ? (
                    postItems.map((tweet, index: number) => (
                      <TweetCard
                        key={(tweet as { id?: string })?.id || index}
                        tweet={tweet as Parameters<typeof TweetCard>[0]['tweet']}
                        ownerProfileImageUrl={profileImageUrl}
                        ownerUsername={username}
                        ownerDisplayName={displayName}
                      />
                    ))
                  ) : (
                    <div className="p-10 text-center text-gray-400">No posts found in this backup.</div>
                  )}
                </div>
              )}

              {activeTab === 'media' && (
                <div className="border-t border-white/10">
                  {!mediaIncluded ? (
                    <div className="p-10 text-center text-gray-400">
                      Media was not included in this snapshot because posts/replies were not included.
                    </div>
                  ) : profileMediaItems.length > 0 ? (
                    <div className="mx-auto max-w-[680px] py-1">
                      <div className="grid grid-cols-3 gap-px">
                      {profileMediaItems.map((media, index) => (
                        <div key={media.id} className="relative aspect-square bg-black">
                          <button
                            type="button"
                            onClick={() => setSelectedMediaIndex(index)}
                            className="h-full w-full text-left"
                          >
                            {media.type === 'photo' ? (
                              <img src={media.url} alt="Tweet media" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <>
                                <video
                                  src={media.url}
                                  className="h-full w-full object-cover"
                                  poster={media.fallbackImageUrl || undefined}
                                  controls
                                  muted
                                  playsInline
                                  loop
                                  autoPlay
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                    const fallback = e.currentTarget.nextElementSibling as HTMLImageElement | null
                                    if (fallback) fallback.style.display = 'block'
                                  }}
                                />
                                {media.fallbackImageUrl ? (
                                  <img
                                    src={media.fallbackImageUrl}
                                    alt="Tweet media"
                                    className="hidden h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                ) : null}
                              </>
                            )}

                            {media.type === 'animated_gif' && (
                              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold text-white">
                                GIF
                              </div>
                            )}
                          </button>

                          {media.tweetUrl ? (
                            <a
                              href={media.tweetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white hover:bg-black/90"
                              onClick={(event) => event.stopPropagation()}
                            >
                              View post
                            </a>
                          ) : null}
                        </div>
                      ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-10 text-center text-gray-400">No photos or videos found in this backup.</div>
                  )}
                </div>
              )}

              {activeTab === 'replies' && (
                <div className="divide-y divide-white/10">
                  {!repliesIncluded ? (
                    <div className="p-10 text-center text-gray-400">Replies were not included in this snapshot.</div>
                  ) : replyItems.length > 0 ? (
                    replyItems.map((tweet, index: number) => (
                      <TweetCard
                        key={(tweet as { id?: string })?.id || index}
                        tweet={tweet as Parameters<typeof TweetCard>[0]['tweet']}
                        ownerProfileImageUrl={profileImageUrl}
                        ownerUsername={username}
                        ownerDisplayName={displayName}
                      />
                    ))
                  ) : (
                    <div className="p-10 text-center text-gray-400">No replies found in this backup.</div>
                  )}
                </div>
              )}
            </section>
            </>
            )}
          </main>

          {viewMode === 'profile' && (
          <aside className="hidden p-4 xl:block">
            <div className="sticky top-4 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-black p-5">
                <h2 className="mb-3 text-[1rem] font-bold">Backup Summary</h2>
                <div className="space-y-2.5 text-[0.9rem]">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Backup type</span>
                    <span className="font-medium text-white">{methodLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Posts</span>
                    <span className="font-medium text-white">{postsIncluded ? tweetCount.toLocaleString() : 'Not included'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Replies</span>
                    <span className="font-medium text-white">{repliesIncluded ? replyCount.toLocaleString() : 'Not included'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Media</span>
                    <span className="font-medium text-white">{mediaIncluded ? mediaCount.toLocaleString() : 'Not included'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Chats</span>
                    <span className="font-medium text-white">{chatsIncluded ? dmCount.toLocaleString() : 'Not included'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Followers</span>
                    <span className="font-medium text-white">{followersIncluded ? formatCount(followersCount) : 'Not included'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Following</span>
                    <span className="font-medium text-white">{followingIncluded ? formatCount(followingCount) : 'Not included'}</span>
                  </div>
                </div>
              </div>

              {backup.archive_file_path && (
                <button
                  onClick={handleDownloadArchive}
                  disabled={isDownloading}
                  className="w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:opacity-60"
                >
                  {isDownloading ? 'Downloading archive...' : 'Download archive ZIP'}
                </button>
              )}

              <div className="rounded-2xl border border-white/10 bg-black p-5">
                <h3 className="mb-2 text-sm font-semibold text-white">Snapshot Context</h3>
                <p className="text-sm text-gray-300">
                  This view recreates the profile and timeline from this backup moment so you can browse it like a live profile.
                </p>
              </div>
            </div>
          </aside>
          )}
        </div>
      </div>

      {selectedMedia && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm">
          <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="relative flex min-h-0 items-center justify-center px-4 py-10">
              <button
                type="button"
                onClick={() => setSelectedMediaIndex(null)}
                className="absolute left-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                aria-label="Close viewer"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {selectedMediaIndex !== null && selectedMediaIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMediaIndex((prev) => (prev === null ? prev : Math.max(prev - 1, 0)))}
                  className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                  aria-label="Previous media"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              {selectedMediaIndex !== null && selectedMediaIndex < profileMediaItems.length - 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedMediaIndex((prev) => (prev === null ? prev : Math.min(prev + 1, profileMediaItems.length - 1)))
                  }
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                  aria-label="Next media"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {selectedMedia.type === 'photo' ? (
                <img src={selectedMedia.url} alt="Selected media" className="max-h-full max-w-full object-contain" />
              ) : selectedMedia.type === 'animated_gif' && isGifUrl(selectedMediaUrl || selectedMedia.url) ? (
                <img src={selectedMediaUrl || selectedMedia.url} alt="Selected GIF" className="max-h-full max-w-full object-contain" />
              ) : selectedMedia.type === 'animated_gif' &&
                !isLikelyVideoUrl(selectedMediaUrl || selectedMedia.url) &&
                selectedMedia.fallbackImageUrl ? (
                <img src={selectedMedia.fallbackImageUrl} alt="Selected GIF" className="max-h-full max-w-full object-contain" />
              ) : selectedMedia.type === 'animated_gif' && (selectedMediaVideoError || !selectedMediaUrl) && selectedMedia.fallbackImageUrl ? (
                <img src={selectedMedia.fallbackImageUrl} alt="Selected GIF" className="max-h-full max-w-full object-contain" />
              ) : (
                <video
                  key={selectedMediaUrl || selectedMedia.url}
                  src={selectedMediaUrl || selectedMedia.url}
                  poster={selectedMedia.fallbackImageUrl || undefined}
                  className="max-h-full max-w-full object-contain"
                  controls
                  autoPlay
                  playsInline
                  loop
                  muted={selectedMedia.type === 'animated_gif'}
                  onError={() => {
                    if (selectedMedia.type === 'animated_gif') {
                      const totalVariants = selectedMedia.variantUrls?.length || 0
                      if (totalVariants > 1 && selectedMediaVariantIndex < totalVariants - 1) {
                        setSelectedMediaVariantIndex((prev) => prev + 1)
                        return
                      }
                      if (selectedMedia.fallbackImageUrl) {
                        setSelectedMediaVideoError(true)
                      }
                    }
                  }}
                />
              )}
            </div>

            <aside className="hidden border-l border-white/10 bg-black/95 lg:block">
              <div className="h-full overflow-y-auto p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-10 w-10 overflow-hidden rounded-full bg-gray-700">
                    {profileImageUrl ? (
                      <img src={profileImageUrl} alt={displayName} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">{displayName}</p>
                    <p className="text-sm text-gray-400">@{username}</p>
                  </div>
                </div>

                {selectedMedia.tweetText ? (
                  <p className="whitespace-pre-wrap text-[1.08rem] leading-8 text-white">{selectedMedia.tweetText}</p>
                ) : (
                  <p className="text-gray-400">Media from backup snapshot.</p>
                )}

                {selectedMedia.tweetUrl && (
                  <a
                    href={selectedMedia.tweetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex text-sm font-medium text-sky-400 hover:underline"
                  >
                    View original post
                  </a>
                )}

                <p className="mt-5 border-b border-white/10 pb-4 text-sm text-gray-400">{formatDate(selectedMedia.createdAt)}</p>

                <div className="mt-4 flex items-center gap-8 text-sm text-gray-300">
                  <span>{selectedMedia.replies} Replies</span>
                  <span>{selectedMedia.reposts} Reposts</span>
                  <span>{selectedMedia.likes} Likes</span>
                  <span>{selectedMedia.views} Views</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {peopleViewOpen && (
        <div className="fixed inset-0 z-40 bg-black">
          <div className="mx-auto flex h-full max-w-[620px] flex-col border-x border-white/10">
            <header className="border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setPeopleViewOpen(false)}
                  className="rounded-full p-1.5 text-2xl hover:bg-white/10"
                >
                  ←
                </button>
                <div>
                  <p className="text-2xl font-bold leading-none">{displayName}</p>
                  <p className="mt-1 text-base text-gray-400">@{username}</p>
                </div>
              </div>
            </header>

            <div className="grid grid-cols-2 border-b border-white/10">
              <button
                type="button"
                onClick={() => setActivePeopleTab('followers')}
                className={`relative px-2 py-4 text-center text-lg font-semibold ${
                  activePeopleTab === 'followers' ? 'text-white' : 'text-gray-500'
                }`}
              >
                Followers
                {activePeopleTab === 'followers' && <span className="absolute bottom-0 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-sky-500" />}
              </button>
              <button
                type="button"
                onClick={() => setActivePeopleTab('following')}
                className={`relative px-2 py-4 text-center text-lg font-semibold ${
                  activePeopleTab === 'following' ? 'text-white' : 'text-gray-500'
                }`}
              >
                Following
                {activePeopleTab === 'following' && <span className="absolute bottom-0 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-sky-500" />}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activePeopleTabIncluded && activePeopleTab === 'followers' && missingFollowersCount > 0 && (
                <div className="border-b border-white/10 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                  Showing {followersRetrievedCount.toLocaleString()} of {followersCount?.toLocaleString()} followers. Some accounts were unavailable from the source API.
                </div>
              )}
              {activePeopleTabIncluded && activePeopleTab === 'following' && missingFollowingCount > 0 && (
                <div className="border-b border-white/10 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                  Showing {followingRetrievedCount.toLocaleString()} of {followingCount?.toLocaleString()} following. Some accounts were unavailable from the source API.
                </div>
              )}
              {!activePeopleTabIncluded ? (
                <div className="p-8 text-center text-lg text-gray-400">
                  {activePeopleTab === 'following'
                    ? 'Following list was not included in this snapshot.'
                    : 'Followers list was not included in this snapshot.'}
                </div>
              ) : currentPeopleList.length > 0 ? (
                currentPeopleList.map((person, index) => {
                  const p = personDisplay(person)
                  const actionLabel = activePeopleTab === 'following' ? 'Following' : 'Follow'
                  return (
                    <a
                      key={`${p.username || p.userId || p.name}-${index}`}
                      href={p.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-3 border-b border-white/10 px-4 py-4 hover:bg-white/5"
                    >
                      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-gray-700">
                        {p.avatar ? <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xl font-bold leading-none">{p.name}</p>
                        <p className="mt-1 truncate text-lg leading-none text-gray-400">
                          {p.username ? `@${p.username}` : p.userId ? `id:${p.userId}` : '@unknown'}
                        </p>
                        {p.bio && <p className="mt-3 text-lg leading-tight text-gray-200">{p.bio}</p>}
                      </div>
                      <button
                        type="button"
                        className={`self-start rounded-full px-6 py-2 text-base font-semibold ${
                          activePeopleTab === 'following'
                            ? 'border border-gray-500 text-white'
                            : 'bg-white text-black'
                        }`}
                      >
                        {actionLabel}
                      </button>
                    </a>
                  )
                })
              ) : (
                <div className="p-8 text-center text-lg text-gray-400">
                  No {activePeopleTab === 'following' ? 'following' : 'followers'} found in this backup.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
