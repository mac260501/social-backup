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

  // Get participant name (not the current user)
  const participant = conversation.participants?.find((p: string) => p !== userId) || 'Unknown'

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <h3 className="font-semibold text-lg text-gray-900 dark:text-white">
          {participant}
        </h3>
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
                isFromUser={message.senderId === userId}
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
