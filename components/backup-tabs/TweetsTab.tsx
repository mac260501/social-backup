'use client'

import { useState, useMemo } from 'react'
import { TweetCard } from '@/components/tweet/TweetCard'

interface TweetsTabProps {
  tweets: any[]
  searchQuery?: string
  ownerProfileImageUrl?: string | null
}

type FilterType = 'all' | 'original' | 'retweets' | 'replies'
type SortType = 'newest' | 'oldest' | 'most-liked'
type DateRange = 'all' | '30-days' | '6-months' | '1-year'

export function TweetsTab({ tweets, searchQuery = '', ownerProfileImageUrl }: TweetsTabProps) {
  const [filter, setFilter] = useState<FilterType>('all')
  const [sort, setSort] = useState<SortType>('newest')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [visibleCount, setVisibleCount] = useState(20)

  // Filter and sort tweets
  const filteredAndSortedTweets = useMemo(() => {
    let result = [...tweets]

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (tweet) =>
          tweet.full_text?.toLowerCase().includes(q) ||
          tweet.user?.screen_name?.toLowerCase().includes(q) ||
          tweet.user?.name?.toLowerCase().includes(q)
      )
    }

    // Apply type filter
    if (filter === 'original') {
      result = result.filter(t => !t.retweeted && !t.in_reply_to_status_id)
    } else if (filter === 'retweets') {
      result = result.filter(t => t.retweeted || t.full_text?.startsWith('RT @'))
    } else if (filter === 'replies') {
      result = result.filter(t => t.in_reply_to_status_id || t.in_reply_to_user_id)
    }

    // Apply date range filter
    if (dateRange !== 'all') {
      const now = new Date()
      const cutoffDate = new Date()

      if (dateRange === '30-days') {
        cutoffDate.setDate(now.getDate() - 30)
      } else if (dateRange === '6-months') {
        cutoffDate.setMonth(now.getMonth() - 6)
      } else if (dateRange === '1-year') {
        cutoffDate.setFullYear(now.getFullYear() - 1)
      }

      result = result.filter(t => {
        const tweetDate = new Date(t.created_at)
        return tweetDate >= cutoffDate
      })
    }

    // Apply sort
    if (sort === 'newest') {
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else if (sort === 'oldest') {
      result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    } else if (sort === 'most-liked') {
      result.sort((a, b) => (b.favorite_count || 0) - (a.favorite_count || 0))
    }

    return result
  }, [tweets, filter, sort, dateRange, searchQuery])

  const visibleTweets = filteredAndSortedTweets.slice(0, visibleCount)
  const hasMore = visibleCount < filteredAndSortedTweets.length

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + 20)
  }

  return (
    <div>
      {/* Filters and Sort Controls */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 space-y-3">
        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('original')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'original'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Original Tweets
          </button>
          <button
            onClick={() => setFilter('retweets')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'retweets'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Retweets
          </button>
          <button
            onClick={() => setFilter('replies')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === 'replies'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Replies
          </button>
        </div>

        {/* Date Range and Sort */}
        <div className="flex flex-wrap gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All time</option>
            <option value="30-days">Last 30 days</option>
            <option value="6-months">Last 6 months</option>
            <option value="1-year">Last year</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortType)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="most-liked">Most liked</option>
          </select>

          <div className="ml-auto text-sm text-gray-500 dark:text-gray-400 py-2">
            Showing {visibleTweets.length} of {filteredAndSortedTweets.length} tweets
          </div>
        </div>
      </div>

      {/* Tweets Feed */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {visibleTweets.length > 0 ? (
          <>
            {visibleTweets.map((tweet, index) => (
              <TweetCard key={tweet.id || index} tweet={tweet} ownerProfileImageUrl={ownerProfileImageUrl} />
            ))}

            {hasMore && (
              <div className="p-6 text-center">
                <button
                  onClick={handleLoadMore}
                  className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-medium"
                >
                  Load More Tweets
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            No tweets found with the selected filters
          </div>
        )}
      </div>
    </div>
  )
}
