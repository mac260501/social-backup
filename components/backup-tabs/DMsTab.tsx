'use client'

import { useState, useMemo } from 'react'
import { ConversationList } from '../dm/ConversationList'
import { MessageThread } from '../dm/MessageThread'

interface DMsTabProps {
  dms: any[]
  userId: string
  searchQuery?: string
}

export function DMsTab({ dms, userId, searchQuery = '' }: DMsTabProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  // Normalize userId to string for consistent comparison
  let normalizedUserId = String(userId)

  // Detect actual user ID from DM data if needed
  // Look at conversation_id pattern to extract user ID
  const detectUserIdFromDMs = () => {
    if (!Array.isArray(dms) || dms.length === 0) return normalizedUserId

    // Get first conversation
    const firstConv = dms[0]
    if (firstConv.conversation_id && firstConv.conversation_id.includes('-')) {
      // conversation_id format: "otherId-yourId" or "yourId-otherId"
      const [id1, id2] = firstConv.conversation_id.split('-')

      // Check which ID appears as sender in the messages
      if (firstConv.messages && firstConv.messages.length > 0) {
        const senderIds = firstConv.messages.map((m: any) => m.sender_id)
        const id1Count = senderIds.filter((id: string) => id === id1).length
        const id2Count = senderIds.filter((id: string) => id === id2).length

        // The ID that appears as sender is likely the user (they're the one sending messages)
        // But we need to check both conversations to be sure
        // For now, let's just use the second ID in the conversation_id as it's more likely to be the user
        return id2
      }
    }

    return normalizedUserId
  }

  // Try to detect the correct user ID from the DM structure
  normalizedUserId = detectUserIdFromDMs()

  // Group DMs by conversation
  const conversations = useMemo(() => {
    const conversationMap = new Map<string, any>()

    // Handle if DMs is an object with conversations inside
    let dmArray = dms
    if (!Array.isArray(dms) && typeof dms === 'object') {
      // Might be { dmConversations: [...] } or similar
      dmArray = dms.dmConversations || dms.conversations || Object.values(dms)
    }

    if (!Array.isArray(dmArray)) {
      return []
    }

    dmArray.forEach((dm) => {
      // Check if this is a conversation object with messages inside
      if (dm.messages && Array.isArray(dm.messages)) {
        // Twitter export format: { conversation_id: "...", messages: [...] }
        const conversationId = dm.conversation_id || dm.conversationId || dm.dmConversationId || 'unknown'

        // Extract participants from conversation_id (format: "userId1-userId2")
        let participants: string[] = dm.participants || []
        let participant = 'Unknown'

        if (!participants.length && conversationId.includes('-')) {
          participants = conversationId.split('-')
        }

        // Find the other participant (not the current user) - ensure string comparison
        participant = participants.find((p: string) => String(p) !== normalizedUserId) || participants[0] || 'Unknown'

        if (!conversationMap.has(conversationId)) {
          conversationMap.set(conversationId, {
            id: conversationId,
            participant: participant,
            messages: [],
            participants: participants
          })
        }

        // Process each message in the conversation
        dm.messages.forEach((msg: any) => {
          const messageData = msg.messageCreate || msg
          const messageText = messageData.text || msg.text || messageData.messageText || messageData.content || ''
          const senderId = messageData.sender_id || messageData.senderId || msg.sender_id || ''
          const recipientId = messageData.recipient_id || messageData.recipientId || msg.recipient_id || ''
          const createdAt = messageData.created_at || messageData.createdAt || msg.created_at || new Date().toISOString()

          conversationMap.get(conversationId)!.messages.push({
            text: messageText,
            senderId: senderId,
            recipientId: recipientId,
            createdAt: createdAt,
            media: messageData.mediaUrls || messageData.media || msg.media || []
          })
        })
      } else {
        // Flat message format: each DM is a separate message
        const conversationId = dm.conversation_id || dm.conversationId || dm.dmConversationId || dm.id || 'unknown'
        const messageData = dm.messageCreate || dm
        const messageText = messageData.text || dm.text || messageData.messageText || messageData.content || ''
        const senderId = messageData.sender_id || messageData.senderId || dm.sender_id || dm.senderId || ''
        const recipientId = messageData.recipient_id || messageData.recipientId || dm.recipient_id || dm.recipientId || ''
        const createdAt = messageData.created_at || messageData.createdAt || dm.created_at || dm.createdAt || new Date().toISOString()
        const participant = dm.participant || dm.recipientScreenName || dm.senderScreenName || 'Unknown'

        if (!conversationMap.has(conversationId)) {
          conversationMap.set(conversationId, {
            id: conversationId,
            participant: participant,
            messages: [],
            participants: dm.participants || [userId, participant]
          })
        }

        conversationMap.get(conversationId)!.messages.push({
          text: messageText,
          senderId: senderId,
          recipientId: recipientId,
          createdAt: createdAt,
          media: messageData.mediaUrls || messageData.media || dm.media || []
        })
      }
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
      .filter((conversation) => {
        // Apply search filter
        if (!searchQuery.trim()) return true
        const q = searchQuery.toLowerCase()
        return (
          conversation.participant?.toLowerCase().includes(q) ||
          conversation.messages.some((msg: any) => msg.text?.toLowerCase().includes(q))
        )
      })
  }, [dms, normalizedUserId, searchQuery])

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
        <MessageThread conversation={selectedConversation} userId={normalizedUserId} />
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
          <MessageThread conversation={selectedConversation} userId={normalizedUserId} />
        </div>
      )}
    </div>
  )
}
