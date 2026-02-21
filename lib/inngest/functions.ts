import type { TwitterScrapeTargets } from '@/lib/twitter/types'
import { inngest } from '@/lib/inngest/client'
import { processArchiveUploadJob } from '@/lib/platforms/twitter/archive-upload-job'
import { processSnapshotScrapeJob } from '@/lib/platforms/twitter/snapshot-scrape-job'
import { runArchiveReminderCycle } from '@/lib/archive-wizard/reminder-runner'

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
      }

      await processArchiveUploadJob({
        jobId: payload.jobId,
        userId: payload.userId,
        username: payload.username,
        inputStoragePath: payload.inputStoragePath,
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
        socialGraphMaxItems: payload.socialGraphMaxItems,
        apifyWebhook: payload.apifyWebhook,
        apiBudget: payload.apiBudget,
      })
    })
  },
)

export const archiveReminderScheduler = inngest.createFunction(
  {
    id: 'archive-reminders-hourly',
    retries: 2,
  },
  { cron: '5 * * * *' },
  async ({ step }) => {
    await step.run('dispatch-archive-reminders', async () => {
      await runArchiveReminderCycle(500)
    })
  },
)

export const inngestFunctions = [archiveUploadProcessor, snapshotScrapeProcessor, archiveReminderScheduler]
