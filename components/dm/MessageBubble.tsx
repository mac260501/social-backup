'use client'

interface MessageBubbleProps {
  message: any
  isFromUser: boolean
}

export function MessageBubble({ message, isFromUser }: MessageBubbleProps) {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className={`flex ${isFromUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[70%] ${isFromUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`rounded-2xl px-4 py-2 ${
            isFromUser
              ? 'bg-blue-500 text-white rounded-br-sm'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-sm'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{message.text}</p>

          {/* Display media inline */}
          {message.media && message.media.length > 0 && (
            <div className="mt-2 space-y-2">
              {message.media.map((media: any, idx: number) => (
                <div key={idx}>
                  {media.type === 'photo' ? (
                    <img
                      src={media.url}
                      alt="Message media"
                      className="rounded-lg max-w-full h-auto"
                    />
                  ) : media.type === 'video' ? (
                    <video
                      src={media.url}
                      controls
                      className="rounded-lg max-w-full h-auto"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`text-xs text-gray-500 dark:text-gray-400 mt-1 px-2 ${isFromUser ? 'text-right' : 'text-left'}`}>
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  )
}
