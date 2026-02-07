'use client'

interface ConversationListProps {
  conversations: any[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {conversations.map((conversation) => {
        const lastMessage = conversation.messages[conversation.messages.length - 1]
        const isSelected = selectedId === conversation.conversationId

        return (
          <button
            key={conversation.conversationId}
            onClick={() => onSelect(conversation.conversationId)}
            className={`w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition ${
              isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Avatar */}
              <div className="flex-shrink-0 w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                {conversation.participant?.charAt(0).toUpperCase() || '?'}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                    {conversation.participant || 'Unknown'}
                  </h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(lastMessage.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 truncate mt-1">
                  {lastMessage.text || 'Media'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {conversation.messages.length} messages
                </p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
