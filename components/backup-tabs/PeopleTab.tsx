'use client'

import { useState, useMemo } from 'react'
import { PersonCard } from '../people/PersonCard'
import { Search } from 'lucide-react'

interface PeopleTabProps {
  followers: any[]
  following: any[]
}

type SubTab = 'followers' | 'following'

export function PeopleTab({ followers, following }: PeopleTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('followers')
  const [searchQuery, setSearchQuery] = useState('')

  const currentPeople = activeSubTab === 'followers' ? followers : following

  const filteredPeople = useMemo(() => {
    if (!searchQuery.trim()) return currentPeople

    const query = searchQuery.toLowerCase()
    return currentPeople.filter((person) => {
      const displayName = (person.accountDisplayName || '').toLowerCase()
      const handle = (person.userLink || '').toLowerCase()
      return displayName.includes(query) || handle.includes(query)
    })
  }, [currentPeople, searchQuery])

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-4 border-b border-gray-200 dark:border-gray-700 mb-6">
        <button
          onClick={() => setActiveSubTab('followers')}
          className={`pb-3 px-4 font-medium transition-colors ${
            activeSubTab === 'followers'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Followers
          <span className="ml-2 text-sm">({followers.length})</span>
        </button>
        <button
          onClick={() => setActiveSubTab('following')}
          className={`pb-3 px-4 font-medium transition-colors ${
            activeSubTab === 'following'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Following
          <span className="ml-2 text-sm">({following.length})</span>
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or handle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Results count */}
      {searchQuery && (
        <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {filteredPeople.length} result{filteredPeople.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* People Grid */}
      {filteredPeople.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPeople.map((person, idx) => (
            <PersonCard key={idx} person={person} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
          {searchQuery ? (
            <p>No people found matching "{searchQuery}"</p>
          ) : (
            <p>
              No {activeSubTab === 'followers' ? 'followers' : 'following'} found
              in this backup
            </p>
          )}
        </div>
      )}
    </div>
  )
}
