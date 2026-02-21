import { Inngest } from 'inngest'

export type ArchiveUploadRequestedEvent = {
  name: 'backup/archive-upload.requested'
  data: {
    jobId: string
    userId: string
    username: string
    inputStoragePath: string
  }
}

export type SnapshotScrapeRequestedEvent = {
  name: 'backup/snapshot-scrape.requested'
  data: {
    jobId: string
    userId: string
    username: string
    tweetsToScrape: number
    targets: {
      profile: boolean
      tweets: boolean
      replies: boolean
      followers: boolean
      following: boolean
    }
    socialGraphMaxItems?: number
    apifyWebhook?: {
      baseUrl: string
      token?: string
    }
    apiBudget: {
      monthlySpentBeforeRunUsd: number
      monthlyLimitUsd: number
      monthlyRemainingUsd: number
      perRunLimitUsd: number
      effectiveRunBudgetUsd: number
      estimatedTimelineCostUsd: number
      estimatedSocialGraphCostUsd: number
      estimatedMaxRunCostUsd: number
    }
  }
}

export type InngestEvents = ArchiveUploadRequestedEvent | SnapshotScrapeRequestedEvent

export const inngest = new Inngest({
  id: 'social-backup',
})
