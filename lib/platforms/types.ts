export const PLATFORM_IDS = ['twitter', 'instagram', 'tiktok'] as const

export type PlatformId = (typeof PLATFORM_IDS)[number]

export type PlatformDefinition = {
  id: PlatformId
  label: string
  shortLabel: string
  enabled: boolean
  backupSources: string[]
}
