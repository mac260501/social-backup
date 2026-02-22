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

const configuredInngestAppId = process.env.INNGEST_APP_ID?.trim() || 'social-backup'
const configuredInngestEventKey = process.env.INNGEST_EVENT_KEY?.trim()
const configuredInngestSigningKey = process.env.INNGEST_SIGNING_KEY?.trim()

export const inngest = new Inngest({
  id: configuredInngestAppId,
  ...(configuredInngestEventKey ? { eventKey: configuredInngestEventKey } : {}),
  ...(configuredInngestSigningKey ? { signingKey: configuredInngestSigningKey } : {}),
})
