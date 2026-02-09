'use client'

import { useState, useEffect } from 'react'
import { Spinner } from '@/components/SkeletonLoader'

interface MediaTabProps {
  backupId: string
  searchQuery?: string
}

interface MediaFile {
  id: string
  file_name: string
  file_path: string
  mime_type: string
  media_type: string
  signedUrl: string | null
  created_at: string
}

export function MediaTab({ backupId, searchQuery = '' }: MediaTabProps) {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<MediaFile | null>(null)
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'images' | 'videos'>('all')

  useEffect(() => {
    async function fetchMedia() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/media?backupId=${backupId}`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch media')
        }

        if (data.success && data.mediaFiles) {
          setMediaFiles(data.mediaFiles)
        }
      } catch (err) {
        console.error('Error fetching media:', err)
        setError(err instanceof Error ? err.message : 'Failed to load media')
      } finally {
        setLoading(false)
      }
    }

    fetchMedia()
  }, [backupId])

  // Determine if file is image or video
  const isImage = (mimeType: string) => mimeType.startsWith('image/')
  const isVideo = (mimeType: string) => mimeType.startsWith('video/')

  // Filter by search query and media type
  let filteredMedia = mediaFiles

  // Apply search filter
  if (searchQuery.trim()) {
    filteredMedia = filteredMedia.filter(media =>
      media.file_name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }

  // Apply media type filter
  if (mediaTypeFilter === 'images') {
    filteredMedia = filteredMedia.filter(media => isImage(media.mime_type))
  } else if (mediaTypeFilter === 'videos') {
    filteredMedia = filteredMedia.filter(media => isVideo(media.mime_type))
  }

  // Count media by type
  const imageCount = mediaFiles.filter(m => isImage(m.mime_type)).length
  const videoCount = mediaFiles.filter(m => isVideo(m.mime_type)).length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-500 dark:text-red-400">
        Error: {error}
      </div>
    )
  }

  if (filteredMedia.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        {searchQuery.trim()
          ? 'No media files match your search'
          : 'No media files found in this backup'}
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Filter Bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Media Type Filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setMediaTypeFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mediaTypeFilter === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            All ({mediaFiles.length})
          </button>
          <button
            onClick={() => setMediaTypeFilter('images')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mediaTypeFilter === 'images'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Photos ({imageCount})
          </button>
          <button
            onClick={() => setMediaTypeFilter('videos')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mediaTypeFilter === 'videos'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Videos ({videoCount})
          </button>
        </div>

        {/* Results Count */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Showing {filteredMedia.length} {filteredMedia.length === 1 ? 'file' : 'files'}
        </div>
      </div>

      {/* Media Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredMedia.map((media) => (
          <div
            key={media.id}
            className="relative group aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
            onClick={() => setSelectedMedia(media)}
          >
            {media.signedUrl ? (
              <>
                {isImage(media.mime_type) ? (
                  <img
                    src={media.signedUrl}
                    alt={media.file_name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                ) : isVideo(media.mime_type) ? (
                  <video
                    src={media.signedUrl}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500">
                    <p className="text-sm">{media.file_name}</p>
                  </div>
                )}

                {/* Hover Overlay with Filename */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-70 transition-opacity flex items-end p-4 opacity-0 group-hover:opacity-100">
                  <p className="text-white text-sm line-clamp-2">
                    {media.file_name}
                  </p>
                </div>

                {/* Video Icon */}
                {isVideo(media.mime_type) && (
                  <div className="absolute top-2 right-2 bg-black bg-opacity-60 rounded-full p-2">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500">
                <p className="text-sm">Unable to load media</p>
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
            {selectedMedia.signedUrl && (
              <>
                {isImage(selectedMedia.mime_type) ? (
                  <img
                    src={selectedMedia.signedUrl}
                    alt={selectedMedia.file_name}
                    className="max-w-full max-h-[80vh] object-contain rounded-lg"
                  />
                ) : isVideo(selectedMedia.mime_type) ? (
                  <video
                    src={selectedMedia.signedUrl}
                    controls
                    autoPlay
                    className="max-w-full max-h-[80vh] object-contain rounded-lg"
                  />
                ) : null}
              </>
            )}

            {/* Filename and Info Below */}
            <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg p-4 max-w-2xl">
              <p className="text-gray-900 dark:text-white font-semibold">
                {selectedMedia.file_name}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Type: {selectedMedia.media_type} • {selectedMedia.mime_type}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Uploaded: {new Date(selectedMedia.created_at).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: 'numeric'
                })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
