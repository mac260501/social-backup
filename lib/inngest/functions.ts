import type { TwitterScrapeTargets } from '@/lib/twitter/types'
import { inngest } from '@/lib/inngest/client'
import { cleanupExpiredGuestBackups } from '@/lib/backups/guest-retention-cleanup'
import type { ArchiveImportSelection, DmEncryptionUploadMetadata } from '@/lib/platforms/twitter/archive-import'
import { processArchiveUploadJob } from '@/lib/platforms/twitter/archive-upload-job'
import { processSnapshotScrapeJob } from '@/lib/platforms/twitter/snapshot-scrape-job'

export const archiveUploadProcessor = inngest.createFunction(
  {
    id: 'archive-upload-processor',
    retries: 5,
  },
  { event: 'backup/archive-upload.requested' },
  async ({ event, step }) => {
    await step.run('process-archive-upload', async () => {
      const payload = event.data as {
        jobId: string
        userId: string
        username: string
        inputStoragePath: string
        importSelection: ArchiveImportSelection
        dmEncryption?: DmEncryptionUploadMetadata | null
        preserveArchiveFile?: boolean
      }

      await processArchiveUploadJob({
        jobId: payload.jobId,
        userId: payload.userId,
        username: payload.username,
        inputStoragePath: payload.inputStoragePath,
        importSelection: payload.importSelection,
        dmEncryption: payload.dmEncryption,
        preserveArchiveFile: payload.preserveArchiveFile,
      })
    })
  },
)

export const snapshotScrapeProcessor = inngest.createFunction(
  {
    id: 'snapshot-scrape-processor',
    retries: 5,
  },
  { event: 'backup/snapshot-scrape.requested' },
  async ({ event, step }) => {
    await step.run('process-snapshot-scrape', async () => {
      const payload = event.data as {
        jobId: string
        userId: string
        username: string
        tweetsToScrape: number
        targets: TwitterScrapeTargets
        includeMedia?: boolean
        retention?: {
          mode: 'account' | 'guest_30d'
          expiresAtIso: string | null
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

      await processSnapshotScrapeJob({
        jobId: payload.jobId,
        userId: payload.userId,
        username: payload.username,
        tweetsToScrape: payload.tweetsToScrape,
        targets: payload.targets,
        includeMedia: payload.includeMedia,
        retention: payload.retention,
        socialGraphMaxItems: payload.socialGraphMaxItems,
        apifyWebhook: payload.apifyWebhook,
        apiBudget: payload.apiBudget,
      })
    })
  },
)

export const guestRetentionCleanup = inngest.createFunction(
  {
    id: 'guest-retention-cleanup',
    retries: 1,
  },
  { cron: 'TZ=UTC 0 4 * * *' },
  async ({ step }) => {
    await step.run('cleanup-expired-guest-backups', async () => {
      const deletedCount = await cleanupExpiredGuestBackups(500)
      return { deletedCount }
    })
  },
)

export const inngestFunctions = [archiveUploadProcessor, snapshotScrapeProcessor, guestRetentionCleanup]
