let zipJsConfigured = false

async function loadZipJs() {
  const zipJs = await import('@zip.js/zip.js')
  if (!zipJsConfigured) {
    // Avoid worker script/CSP issues and keep extraction deterministic in-browser.
    zipJs.configure({ useWebWorkers: false })
    zipJsConfigured = true
  }
  return zipJs
}

const DIRECT_MESSAGE_PATTERNS = [
  /^data\/direct-messages(?:-part\d+)?\.js$/i,
  /^data\/direct_messages(?:-part\d+)?\.js$/i,
]

function normalizeZipEntryName(fileName: string): string {
  return fileName.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function toArchiveRelativePath(fileName: string): string {
  const normalized = normalizeZipEntryName(fileName)
  const dataIndex = normalized.toLowerCase().indexOf('data/')
  if (dataIndex < 0) return normalized
  return normalized.slice(dataIndex)
}

function extractPartNumber(fileName: string): number {
  const match = /-part(\d+)\.js$/i.exec(fileName)
  if (!match) return 0
  return Number.parseInt(match[1], 10) || 0
}

function extractJsonLiteral(content: string, startIndex: number): { value: string; endIndex: number } | null {
  const opening = content[startIndex]
  if (opening !== '[' && opening !== '{') return null

  const stack: string[] = [opening]
  let inString = false
  let escaped = false

  for (let i = startIndex + 1; i < content.length; i += 1) {
    const char = content[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '[' || char === '{') {
      stack.push(char)
      continue
    }

    if (char === ']' || char === '}') {
      const expected = char === ']' ? '[' : '{'
      const top = stack[stack.length - 1]
      if (top !== expected) continue
      stack.pop()
      if (stack.length === 0) {
        return {
          value: content.slice(startIndex, i + 1),
          endIndex: i,
        }
      }
    }
  }

  return null
}

function parseTwitterJSON(content: string): unknown[] {
  const normalized = content.replace(/^\uFEFF/, '')
  const parsedSegments: unknown[] = []

  const assignmentRegex = /=\s*([\[{])/g
  while (true) {
    const nextMatch = assignmentRegex.exec(normalized)
    if (!nextMatch) break
    const startIndex = assignmentRegex.lastIndex - 1
    const extracted = extractJsonLiteral(normalized, startIndex)
    if (!extracted) {
      assignmentRegex.lastIndex = Math.max(assignmentRegex.lastIndex, startIndex + 1)
      continue
    }

    try {
      const parsed = JSON.parse(extracted.value) as unknown
      if (Array.isArray(parsed)) parsedSegments.push(...parsed)
      else if (parsed && typeof parsed === 'object') parsedSegments.push(parsed)
    } catch {
      // Ignore malformed segment and continue reading remaining data.
    }

    assignmentRegex.lastIndex = extracted.endIndex + 1
  }

  if (parsedSegments.length > 0) return parsedSegments

  const trimmed = normalized.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
  } catch {
    // no-op
  }

  return []
}

function mapDirectMessages(rawItems: unknown[]): unknown[] {
  return rawItems
    .map((entry) => {
      const item = entry as Record<string, unknown>
      const dmConversation = item.dmConversation as Record<string, unknown> | undefined
      const messages = Array.isArray(dmConversation?.messages) ? dmConversation.messages : []

      const mappedMessages = messages.map((messageEntry) => {
        const message = messageEntry as Record<string, unknown>
        const messageCreate = message.messageCreate as Record<string, unknown> | undefined

        const senderId = messageCreate?.senderId
        const recipientId = messageCreate?.recipientId

        return {
          text: (messageCreate?.text as string | undefined) || '',
          created_at: (messageCreate?.createdAt as string | undefined) || '',
          sender_id: senderId,
          recipient_id: recipientId,
          senderLink: senderId ? `https://twitter.com/intent/user?user_id=${String(senderId)}` : undefined,
          recipientLink: recipientId ? `https://twitter.com/intent/user?user_id=${String(recipientId)}` : undefined,
          media: (messageCreate?.mediaUrls as unknown[] | undefined) || (messageCreate?.media as unknown[] | undefined) || [],
        }
      })

      return {
        conversation_id: (dmConversation?.conversationId as string | undefined) || '',
        messages: mappedMessages,
        message_count: mappedMessages.length,
      }
    })
    .filter((entry) => typeof (entry as { conversation_id?: unknown }).conversation_id === 'string' && (entry as { conversation_id: string }).conversation_id)
}

export async function extractDirectMessagesFromArchiveFile(file: File): Promise<{ directMessages: unknown[]; messageCount: number }> {
  const zipJs = await loadZipJs()
  const reader = new zipJs.ZipReader(new zipJs.BlobReader(file), {
    useWebWorkers: false,
  })

  const entries = await reader.getEntries()

  const directMessageEntries = entries
    .filter((entry) => {
      if (entry.directory) return false
      const relativePath = toArchiveRelativePath(entry.filename)
      return DIRECT_MESSAGE_PATTERNS.some((pattern) => pattern.test(relativePath))
    })
    .sort((a, b) => {
      const relA = toArchiveRelativePath(a.filename)
      const relB = toArchiveRelativePath(b.filename)
      const partA = extractPartNumber(relA)
      const partB = extractPartNumber(relB)
      if (partA !== partB) return partA - partB
      return relA.localeCompare(relB)
    })

  try {
    const parsedItems: unknown[] = []
    for (const entry of directMessageEntries) {
      if (entry.directory) continue
      const content = await entry.getData(new zipJs.TextWriter())
      if (!content) continue
      parsedItems.push(...parseTwitterJSON(content))
    }

    const directMessages = mapDirectMessages(parsedItems)
    const messageCount = directMessages.reduce<number>((sum, entry) => {
      if (!entry || typeof entry !== 'object') return sum
      const messageCount = (entry as { message_count?: unknown }).message_count
      return sum + (typeof messageCount === 'number' && Number.isFinite(messageCount) ? messageCount : 0)
    }, 0)

    return {
      directMessages,
      messageCount,
    }
  } finally {
    await reader.close()
  }
}
