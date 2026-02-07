'use client'

import { useState, useMemo } from 'react'
import { ConversationList } from '../dm/ConversationList'
import { MessageThread } from '../dm/MessageThread'

interface DMsTabProps {
  dms: any[]
  userId: string
}

export function DMsTab({ dms, userId }: DMsTabProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  // Group DMs by conversation
  const conversations = useMemo(() => {
    const conversationMap = new Map<string, any>()

    dms.forEach((dm) => {
      const conversationId = dm.conversationId || dm.participant || 'unknown'

      if (!conversationMap.has(conversationId)) {
        conversationMap.set(conversationId, {
          id: conversationId,
          participant: dm.participant || 'Unknown',
          messages: [],
          participants: dm.participants || [userId, dm.participant]
        })
      }

      conversationMap.get(conversationId)!.messages.push({
        text: dm.text,
        senderId: dm.senderId,
        recipientId: dm.recipientId,
        createdAt: dm.createdAt,
        media: dm.media
      })
    })

    // Convert map to array and sort messages by date
    return Array.from(conversationMap.values()).map((conversation) => {
      conversation.messages.sort(
        (a: any, b: any) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      // Add metadata for conversation list
      const lastMessage = conversation.messages[conversation.messages.length - 1]
      conversation.lastMessage = lastMessage?.text || ''
      conversation.lastMessageDate = lastMessage?.createdAt || ''
      conversation.messageCount = conversation.messages.length

      return conversation
    })
      .sort((a, b) =>
        new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime()
      )
  }, [dms, userId])

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId),
    [conversations, selectedConversationId]
  )

  // Auto-select first conversation if none selected
  if (!selectedConversationId && conversations.length > 0) {
    setSelectedConversationId(conversations[0].id)
  }

  if (dms.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        <p>No direct messages found in this backup</p>
      </div>
    )
  }

  return (
    <div className="flex h-[600px] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {/* Left Pane - Conversation List */}
      <div className="w-full lg:w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <ConversationList
          conversations={conversations}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
        />
      </div>

      {/* Right Pane - Message Thread */}
      <div className="hidden lg:flex lg:w-2/3">
        <MessageThread conversation={selectedConversation} userId={userId} />
      </div>

      {/* Mobile: Show thread only when selected (overlay) */}
      {selectedConversationId && (
        <div className="lg:hidden fixed inset-0 bg-white dark:bg-gray-900 z-50 flex flex-col">
          <button
            onClick={() => setSelectedConversationId(null)}
            className="p-4 text-left border-b border-gray-200 dark:border-gray-700"
          >
            ← Back to conversations
          </button>
          <MessageThread conversation={selectedConversation} userId={userId} />
        </div>
      )}
    </div>
  )
}
