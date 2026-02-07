'use client'

interface SkeletonLoaderProps {
  type?: 'tweet' | 'card' | 'list' | 'media' | 'stat'
  count?: number
}

export function SkeletonLoader({ type = 'card', count = 3 }: SkeletonLoaderProps) {
  const skeletons = Array.from({ length: count }, (_, i) => i)

  if (type === 'tweet') {
    return (
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {skeletons.map((i) => (
          <div key={i} className="p-6 animate-pulse">
            <div className="flex gap-3">
              {/* Avatar */}
              <div className="w-12 h-12 bg-gray-300 dark:bg-gray-700 rounded-full flex-shrink-0" />

              <div className="flex-1 space-y-3">
                {/* Header */}
                <div className="flex gap-2">
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-32" />
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24" />
                </div>

                {/* Text lines */}
                <div className="space-y-2">
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-full" />
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-5/6" />
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-4/6" />
                </div>

                {/* Engagement */}
                <div className="flex gap-6 pt-2">
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-16" />
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-16" />
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-16" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'media') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {skeletons.map((i) => (
          <div
            key={i}
            className="aspect-square bg-gray-300 dark:bg-gray-700 rounded-lg animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (type === 'list') {
    return (
      <div className="space-y-2">
        {skeletons.map((i) => (
          <div key={i} className="p-4 bg-white dark:bg-gray-800 rounded-lg animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4" />
                <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'stat') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {skeletons.map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gray-300 dark:bg-gray-700 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-20" />
                <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Default card skeleton
  return (
    <div className="space-y-4">
      {skeletons.map((i) => (
        <div
          key={i}
          className="p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg animate-pulse"
        >
          <div className="space-y-3">
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/2" />
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-5/6" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Simple spinner component
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4'
  }

  return (
    <div
      className={`${sizeClasses[size]} border-gray-300 border-t-blue-500 rounded-full animate-spin`}
    />
  )
}
