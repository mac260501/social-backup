'use client'

import { Search, X } from 'lucide-react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  className = ''
}: SearchBarProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 pl-10 pr-10 bg-gray-100 dark:bg-gray-700 border-none rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 transition-all"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label="Clear search"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}

// Utility function to highlight matching text
export function highlightText(text: string, query: string) {
  if (!query.trim()) return text

  const parts = text.split(new RegExp(`(${query})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-600 text-gray-900 dark:text-white">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

// Search filter functions
export const searchFilters = {
  tweets: (tweets: any[], query: string) => {
    if (!query.trim()) return tweets
    const q = query.toLowerCase()
    return tweets.filter(
      (tweet) =>
        tweet.full_text?.toLowerCase().includes(q) ||
        tweet.user?.screen_name?.toLowerCase().includes(q) ||
        tweet.user?.name?.toLowerCase().includes(q)
    )
  },

  people: (people: any[], query: string) => {
    if (!query.trim()) return people
    const q = query.toLowerCase()
    return people.filter(
      (person) =>
        person.accountDisplayName?.toLowerCase().includes(q) ||
        person.userLink?.toLowerCase().includes(q) ||
        person.bio?.toLowerCase().includes(q)
    )
  },

  dms: (dms: any[], query: string) => {
    if (!query.trim()) return dms
    const q = query.toLowerCase()
    return dms.filter(
      (dm) =>
        dm.text?.toLowerCase().includes(q) ||
        dm.participant?.toLowerCase().includes(q)
    )
  }
}
