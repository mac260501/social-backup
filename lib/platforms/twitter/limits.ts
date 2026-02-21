const MB = 1024 * 1024
const GB = 1024 * MB

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function readPositiveFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export const TWITTER_UPLOAD_LIMITS = {
  maxArchiveBytes: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_BYTES', 1 * GB),
  maxZipEntries: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_ZIP_ENTRIES', 50_000),
  maxMediaFiles: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_MEDIA_FILES', 20_000),
  maxMediaBytes: readPositiveIntEnv('TWITTER_MAX_ARCHIVE_MEDIA_BYTES', 5 * GB),
}

export const USER_STORAGE_LIMITS = {
  maxTotalBytes: readPositiveIntEnv('USER_MAX_TOTAL_STORAGE_BYTES', 5 * GB),
}

export const TWITTER_SCRAPE_LIMITS = {
  defaultTweets: readPositiveIntEnv('TWITTER_SCRAPE_DEFAULT_TWEETS', 500),
}

export const TWITTER_SCRAPE_API_LIMITS = {
  // Apify pricing defaults from actor pages:
  // - apidojo/twitter-profile-scraper: $0.016 per profile query + $0.0004 per result item after first 40
  // - apidojo/twitter-user-scraper: $0.40 per 1,000 users ($0.0004 each)
  profileQueryBaseUsd: readPositiveFloatEnv('TWITTER_APIFY_PROFILE_QUERY_BASE_USD', 0.016),
  profileIncludedItems: readPositiveIntEnv('TWITTER_APIFY_PROFILE_INCLUDED_ITEMS', 40),
  profileExtraItemUsd: readPositiveFloatEnv('TWITTER_APIFY_PROFILE_EXTRA_ITEM_USD', 0.0004),
  socialGraphItemUsd: readPositiveFloatEnv('TWITTER_APIFY_USER_ITEM_USD', 0.0004),
  maxCostPerRunUsd: readPositiveFloatEnv('TWITTER_SCRAPE_API_MAX_COST_PER_RUN_USD', 25),
  maxCostPerMonthUsd: readPositiveFloatEnv('TWITTER_SCRAPE_API_MAX_COST_PER_MONTH_USD', 20),
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
