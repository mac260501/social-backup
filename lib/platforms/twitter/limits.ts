const MB = 1024 * 1024
const GB = 1024 * MB

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export const TWITTER_UPLOAD_LIMITS = {
  maxArchiveBytes: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_BYTES', 512 * MB),
  maxZipEntries: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_ZIP_ENTRIES', 50_000),
  maxMediaFiles: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_MEDIA_FILES', 20_000),
  maxMediaBytes: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_MEDIA_BYTES', 5 * GB),
}

export const TWITTER_SCRAPE_LIMITS = {
  minTweets: readPositiveIntEnv('TWITTER_SCRAPE_MIN_TWEETS', 10),
  defaultTweets: readPositiveIntEnv('TWITTER_SCRAPE_DEFAULT_TWEETS', 500),
  maxTweets: readPositiveIntEnv('TWITTER_SCRAPE_MAX_TWEETS', 1000),
}

export function isZipUpload(fileName: string, mimeType: string | undefined): boolean {
  const normalizedName = fileName.toLowerCase()
  const normalizedType = (mimeType || '').toLowerCase()

  const hasZipExtension = normalizedName.endsWith('.zip')
  if (!hasZipExtension) return false

  // Browsers may send empty file.type for drag/drop or some OS integrations.
  if (!normalizedType) return true

  return (
    normalizedType === 'application/zip' ||
    normalizedType === 'application/x-zip-compressed' ||
    normalizedType === 'multipart/x-zip'
  )
}

export function parseRequestedTweetCount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return TWITTER_SCRAPE_LIMITS.defaultTweets

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN

  if (!Number.isFinite(parsed)) return null
  if (!Number.isInteger(parsed)) return null

  return parsed
}
