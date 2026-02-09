'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Download, Check } from 'lucide-react'

interface RawDataTabProps {
  backup: any
}

export function RawDataTab({ backup }: RawDataTabProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  const toggleSection = (sectionName: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(sectionName)) {
      newExpanded.delete(sectionName)
    } else {
      newExpanded.add(sectionName)
    }
    setExpandedSections(newExpanded)
  }

  const copyToClipboard = async (data: any, sectionName: string) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      setCopiedSection(sectionName)
      setTimeout(() => setCopiedSection(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const downloadJSON = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const sections = [
    {
      name: 'Account Info',
      data: {
        userId: backup.userId,
        backupName: backup.name,
        backupDate: backup.backupDate,
        stats: backup.stats
      },
      count: null
    },
    {
      name: 'Tweets',
      data: backup.data?.tweets || [],
      count: (backup.data?.tweets || []).length
    },
    {
      name: 'Followers',
      data: backup.data?.followers || [],
      count: (backup.data?.followers || []).length
    },
    {
      name: 'Following',
      data: backup.data?.following || [],
      count: (backup.data?.following || []).length
    },
    {
      name: 'Likes',
      data: backup.data?.likes || [],
      count: (backup.data?.likes || []).length
    },
    {
      name: 'DMs',
      data: backup.data?.dms || backup.data?.direct_messages || backup.data?.directMessages || [],
      count: (backup.data?.dms || backup.data?.direct_messages || backup.data?.directMessages || []).length
    }
  ]

  const downloadAll = () => {
    downloadJSON(backup, `backup-${backup.name}-${Date.now()}.json`)
  }

  const copyAll = async () => {
    await copyToClipboard(backup, 'all')
  }

  return (
    <div>
      {/* Header Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={copyAll}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          {copiedSection === 'all' ? (
            <>
              <Check className="w-4 h-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy All JSON
            </>
          )}
        </button>
        <button
          onClick={downloadAll}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download All JSON
        </button>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((section) => {
          const isExpanded = expandedSections.has(section.name)
          const isCopied = copiedSection === section.name

          return (
            <div
              key={section.name}
              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800"
            >
              {/* Section Header */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700">
                <button
                  onClick={() => toggleSection(section.name)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  )}
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {section.name}
                  </span>
                  {section.count !== null && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({section.count} items)
                    </span>
                  )}
                </button>

                <div className="flex gap-2">
                  <button
                    onClick={() => copyToClipboard(section.data, section.name)}
                    className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    title="Copy JSON"
                  >
                    {isCopied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      downloadJSON(
                        section.data,
                        `${section.name.toLowerCase().replace(' ', '-')}-${Date.now()}.json`
                      )
                    }
                    className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    title="Download JSON"
                  >
                    <Download className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>

              {/* Section Content */}
              {isExpanded && (
                <div className="p-4 max-h-96 overflow-auto bg-gray-100 dark:bg-gray-900">
                  <pre className="text-xs text-gray-900 dark:text-gray-300 font-mono">
                    <code className="language-json">
                      {JSON.stringify(section.data, null, 2)}
                    </code>
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
