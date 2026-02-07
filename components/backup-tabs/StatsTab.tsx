'use client'

import { useMemo } from 'react'
import { TweetCard } from '../tweet/TweetCard'
import {
  MessageCircle,
  Repeat2,
  Heart,
  Users,
  UserPlus,
  Calendar,
  TrendingUp,
  BarChart3
} from 'lucide-react'

interface StatsTabProps {
  backup: any
  tweets: any[]
}

export function StatsTab({ backup, tweets }: StatsTabProps) {
  const stats = useMemo(() => {
    const totalTweets = tweets.length
    const totalLikes = tweets.reduce((sum, t) => sum + (t.favorite_count || 0), 0)
    const totalRetweets = tweets.reduce((sum, t) => sum + (t.retweet_count || 0), 0)
    const totalReplies = tweets.reduce((sum, t) => sum + (t.reply_count || 0), 0)

    const avgLikes = totalTweets > 0 ? (totalLikes / totalTweets).toFixed(1) : '0'
    const avgRetweets = totalTweets > 0 ? (totalRetweets / totalTweets).toFixed(1) : '0'

    // Find most liked tweet
    const mostLiked = tweets.reduce(
      (max, t) => ((t.favorite_count || 0) > (max.favorite_count || 0) ? t : max),
      tweets[0] || {}
    )

    // Find most retweeted tweet
    const mostRetweeted = tweets.reduce(
      (max, t) => ((t.retweet_count || 0) > (max.retweet_count || 0) ? t : max),
      tweets[0] || {}
    )

    // Calculate account age
    let accountAge = 'Unknown'
    let firstTweetDate = 'Unknown'
    if (tweets.length > 0) {
      const sortedTweets = [...tweets].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      const firstTweet = sortedTweets[0]
      if (firstTweet?.created_at) {
        const firstDate = new Date(firstTweet.created_at)
        firstTweetDate = firstDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })

        const now = new Date()
        const diffTime = Math.abs(now.getTime() - firstDate.getTime())
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        const years = Math.floor(diffDays / 365)
        const months = Math.floor((diffDays % 365) / 30)

        if (years > 0) {
          accountAge = `${years} year${years > 1 ? 's' : ''}`
          if (months > 0) {
            accountAge += `, ${months} month${months > 1 ? 's' : ''}`
          }
        } else if (months > 0) {
          accountAge = `${months} month${months > 1 ? 's' : ''}`
        } else {
          accountAge = `${diffDays} day${diffDays > 1 ? 's' : ''}`
        }
      }
    }

    return {
      totalTweets,
      totalLikes,
      totalRetweets,
      totalReplies,
      avgLikes,
      avgRetweets,
      mostLiked,
      mostRetweeted,
      accountAge,
      firstTweetDate
    }
  }, [tweets])

  const StatCard = ({ icon: Icon, label, value, color }: any) => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
      <div className="flex items-center gap-4">
        <div className={`${color} p-3 rounded-lg`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-8">
      {/* Overview Stats */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Overview
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={MessageCircle}
            label="Total Tweets"
            value={stats.totalTweets.toLocaleString()}
            color="bg-blue-500"
          />
          <StatCard
            icon={Users}
            label="Followers"
            value={(backup.stats?.followers || 0).toLocaleString()}
            color="bg-purple-500"
          />
          <StatCard
            icon={UserPlus}
            label="Following"
            value={(backup.stats?.following || 0).toLocaleString()}
            color="bg-green-500"
          />
          <StatCard
            icon={Heart}
            label="Total Likes"
            value={stats.totalLikes.toLocaleString()}
            color="bg-pink-500"
          />
        </div>
      </div>

      {/* Engagement Stats */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Engagement
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={TrendingUp}
            label="Avg Likes per Tweet"
            value={stats.avgLikes}
            color="bg-orange-500"
          />
          <StatCard
            icon={Repeat2}
            label="Avg Retweets per Tweet"
            value={stats.avgRetweets}
            color="bg-teal-500"
          />
          <StatCard
            icon={Repeat2}
            label="Total Retweets"
            value={stats.totalRetweets.toLocaleString()}
            color="bg-indigo-500"
          />
          <StatCard
            icon={BarChart3}
            label="Total Replies"
            value={stats.totalReplies.toLocaleString()}
            color="bg-yellow-500"
          />
        </div>
      </div>

      {/* Account Info */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Account Info
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StatCard
            icon={Calendar}
            label="First Tweet Date"
            value={stats.firstTweetDate}
            color="bg-gray-500"
          />
          <StatCard
            icon={Calendar}
            label="Account Age"
            value={stats.accountAge}
            color="bg-red-500"
          />
        </div>
      </div>

      {/* Most Liked Tweet */}
      {stats.mostLiked?.id && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Most Liked Tweet ({stats.mostLiked.favorite_count?.toLocaleString() || 0} likes)
          </h3>
          <TweetCard tweet={stats.mostLiked} />
        </div>
      )}

      {/* Most Retweeted Tweet */}
      {stats.mostRetweeted?.id && stats.mostRetweeted.id !== stats.mostLiked?.id && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Most Retweeted Tweet ({stats.mostRetweeted.retweet_count?.toLocaleString() || 0} retweets)
          </h3>
          <TweetCard tweet={stats.mostRetweeted} />
        </div>
      )}
    </div>
  )
}
