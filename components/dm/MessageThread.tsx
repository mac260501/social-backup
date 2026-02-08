'use client'

import { MessageBubble } from './MessageBubble'
import { useEffect, useRef } from 'react'

interface MessageThreadProps {
  conversation: any
  userId: string
}

export function MessageThread({ conversation, userId }: MessageThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages])

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>Select a conversation to view messages</p>
      </div>
    )
  }

  // Get participant name (not the current user) - ensure string comparison
  const normalizedUserId = String(userId)
  const participant = conversation.participant ||
    conversation.participants?.find((p: string) => String(p) !== normalizedUserId) ||
    'Unknown'

  // Generate Twitter profile URL for participant
  const participantUrl = `https://twitter.com/intent/user?user_id=${participant}`

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <a
          href={participantUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-lg text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        >
          {participant}
        </a>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {conversation.messages?.length || 0} messages
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
        {conversation.messages && conversation.messages.length > 0 ? (
          <>
            {conversation.messages.map((message: any, idx: number) => (
              <MessageBubble
                key={idx}
                message={message}
                isFromUser={String(message.senderId) === normalizedUserId}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 dark:text-gray-400">No messages in this conversation</p>
          </div>
        )}
      </div>
    </div>
  )
}
