// Shared types for all Twitter providers

export interface TweetMedia {
  url: string
  type: 'photo' | 'video' | 'animated_gif'
  media_url?: string  // Direct URL to media file
}

export interface Tweet {
  id: string
  text: string
  created_at: string
  retweet_count?: number
  favorite_count?: number
  reply_count?: number
  author?: {
    username: string
    name: string
    profileImageUrl?: string
  }
  media?: TweetMedia[]  // Media attachments (photos, videos, gifs)
}

export interface Follower {
  user_id: string
  username?: string
  name?: string
  userLink: string
  profileImageUrl?: string
}

export interface Following {
  user_id: string
  username?: string
  name?: string
  userLink: string
  profileImageUrl?: string
}

export interface Like {
  tweet_id: string
  full_text?: string
  liked_at?: string
}

export interface TwitterScrapeCost {
  provider: 'apify' | 'twitter-api'
  total_cost: number // in USD
  tweets_count: number
  breakdown?: {
    tweets?: number
    followers?: number
    following?: number
  }
}

export interface TwitterScrapeResult {
  tweets: Tweet[]
  followers: Follower[]
  following: Following[]
  cost: TwitterScrapeCost
  metadata: {
    username: string
    scraped_at: string
    is_partial: boolean // true if hit rate limits
    tweets_requested: number
    tweets_received: number
    profileImageUrl?: string
    coverImageUrl?: string
    displayName?: string
  }
}
