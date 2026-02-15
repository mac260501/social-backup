import type { PlatformDefinition, PlatformId } from '@/lib/platforms/types'

export const PLATFORM_REGISTRY: Record<PlatformId, PlatformDefinition> = {
  twitter: {
    id: 'twitter',
    label: 'X (Twitter)',
    shortLabel: 'X',
    enabled: true,
    backupSources: ['archive', 'scrape', 'api', 'archive_upload'],
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    shortLabel: 'Instagram',
    enabled: false,
    backupSources: ['instagram_archive', 'instagram_api'],
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    shortLabel: 'TikTok',
    enabled: false,
    backupSources: ['tiktok_archive', 'tiktok_api'],
  },
}

export function getPlatformDefinition(platformId: PlatformId) {
  return PLATFORM_REGISTRY[platformId]
}

export function listPlatformDefinitions() {
  return Object.values(PLATFORM_REGISTRY)
}
