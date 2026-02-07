'use client'

import { useState } from 'react'

interface MediaTabProps {
  tweets: any[]
  searchQuery?: string
}

export function MediaTab({ tweets, searchQuery = '' }: MediaTabProps) {
  const [selectedMedia, setSelectedMedia] = useState<any>(null)

  // Filter tweets that have media
  let tweetsWithMedia = tweets.filter(tweet =>
    tweet.media && tweet.media.length > 0
  )

  // Apply search filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase()
    tweetsWithMedia = tweetsWithMedia.filter(tweet =>
      tweet.full_text?.toLowerCase().includes(q) ||
      tweet.text?.toLowerCase().includes(q)
    )
  }

  // Flatten all media items with their parent tweet
  const allMedia = tweetsWithMedia.flatMap(tweet =>
    tweet.media.map((media: any) => ({
      ...media,
      tweet
    }))
  )

  return (
    <div className="p-6">
      {allMedia.length > 0 ? (
        <>
          {/* Media Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {allMedia.map((media: any, index: number) => (
              <div
                key={index}
                className="relative group aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
                onClick={() => setSelectedMedia(media)}
              >
                {media.type === 'photo' ? (
                  <img
                    src={media.media_url || media.url}
                    alt="Media"
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : media.type === 'video' || media.type === 'animated_gif' ? (
                  <video
                    src={media.media_url || media.url}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : null}

                {/* Hover Overlay with Tweet Text */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-70 transition-opacity flex items-end p-4 opacity-0 group-hover:opacity-100">
                  <p className="text-white text-sm line-clamp-3">
                    {media.tweet.full_text || media.tweet.text}
                  </p>
                </div>

                {/* Video Icon */}
                {(media.type === 'video' || media.type === 'animated_gif') && (
                  <div className="absolute top-2 right-2 bg-black bg-opacity-60 rounded-full p-2">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Lightbox Modal */}
          {selectedMedia && (
            <div
              className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedMedia(null)}
            >
              <div className="relative max-w-7xl max-h-full" onClick={(e) => e.stopPropagation()}>
                {/* Close Button */}
                <button
                  onClick={() => setSelectedMedia(null)}
                  className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
                >
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Media Content */}
                {selectedMedia.type === 'photo' ? (
                  <img
                    src={selectedMedia.media_url || selectedMedia.url}
                    alt="Media"
                    className="max-w-full max-h-[80vh] object-contain rounded-lg"
                  />
                ) : (
                  <video
                    src={selectedMedia.media_url || selectedMedia.url}
                    controls
                    autoPlay
                    className="max-w-full max-h-[80vh] object-contain rounded-lg"
                  />
                )}

                {/* Tweet Text Below */}
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg p-4 max-w-2xl">
                  <p className="text-gray-900 dark:text-white">
                    {selectedMedia.tweet.full_text || selectedMedia.tweet.text}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {new Date(selectedMedia.tweet.created_at).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No media found in your tweets
        </div>
      )}
    </div>
  )
}
