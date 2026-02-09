'use client'

interface TweetTextProps {
  text: string
}

export function TweetText({ text }: TweetTextProps) {
  // Parse tweet text and return formatted JSX
  const parseText = (text: string) => {
    if (!text) return null

    const elements: React.ReactNode[] = []
    let lastIndex = 0

    // Combined regex for URLs, mentions, and hashtags
    const pattern = /(https?:\/\/[^\s]+)|(@\w+)|(#\w+)/g
    let match

    while ((match = pattern.exec(text)) !== null) {
      const matchStart = match.index
      const matchEnd = matchStart + match[0].length

      // Add text before the match
      if (matchStart > lastIndex) {
        const textBefore = text.substring(lastIndex, matchStart)
        elements.push(
          <span key={`text-${lastIndex}`}>
            {textBefore}
          </span>
        )
      }

      // Add the matched element (URL, mention, or hashtag)
      if (match[1]) {
        // URL
        const url = match[1]
        elements.push(
          <a
            key={`url-${matchStart}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {url}
          </a>
        )
      } else if (match[2]) {
        // @mention
        const mention = match[2]
        elements.push(
          <span
            key={`mention-${matchStart}`}
            className="text-blue-500 dark:text-blue-400 hover:underline cursor-pointer"
          >
            {mention}
          </span>
        )
      } else if (match[3]) {
        // #hashtag
        const hashtag = match[3]
        elements.push(
          <span
            key={`hashtag-${matchStart}`}
            className="text-blue-500 dark:text-blue-400 hover:underline cursor-pointer"
          >
            {hashtag}
          </span>
        )
      }

      lastIndex = matchEnd
    }

    // Add any remaining text after the last match
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex)
      elements.push(
        <span key={`text-${lastIndex}`}>
          {remainingText}
        </span>
      )
    }

    return elements
  }

  // Split text by newlines and render with line breaks
  const lines = text.split('\n')

  return (
    <div className="whitespace-pre-wrap break-words">
      {lines.map((line, lineIndex) => (
        <span key={lineIndex}>
          {parseText(line)}
          {lineIndex < lines.length - 1 && <br />}
        </span>
      ))}
    </div>
  )
}
