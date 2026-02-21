import type { SupabaseClient } from '@supabase/supabase-js'
import { TWITTER_SCRAPE_API_LIMITS } from './limits'
import { roundUsd } from '@/lib/twitter/apify-pricing'

type ScrapeCostRow = {
  id?: string | null
  scrape_cost?: number | string | null
}

type SnapshotBackupRow = {
  id?: string | null
  data?: unknown
}

type SnapshotJobCostRow = {
  result_backup_id?: string | null
  payload?: unknown
}

function parseUsd(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  const message = String((error as { message?: unknown }).message || '').toLowerCase()
  return code === '42703' && message.includes(`column backups.${columnName}`.toLowerCase())
}

function isMissingRelationError(error: unknown, relationName: string): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  const message = String((error as { message?: unknown }).message || '').toLowerCase()
  return code === '42P01' && message.includes(relationName.toLowerCase())
}

function parseId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseSnapshotJobCostUsd(payload: unknown): number {
  const payloadRecord = toRecord(payload)
  const liveMetrics = toRecord(payloadRecord.live_metrics)
  const scrape = toRecord(payloadRecord.scrape)
  return parseUsd(
    liveMetrics.api_cost_usd
    ?? payloadRecord.api_cost_usd
    ?? scrape.total_cost,
  )
}

function extractLinkedBackupIdsFromJob(job: SnapshotJobCostRow): string[] {
  const payload = toRecord(job.payload)
  const candidates = [
    job.result_backup_id,
    payload.result_backup_id,
    payload.created_backup_id,
    payload.partial_backup_id,
  ]
  const linked = new Set<string>()
  for (const candidate of candidates) {
    const parsed = parseId(candidate)
    if (parsed) linked.add(parsed)
  }
  return Array.from(linked)
}

async function loadMonthlySpendByTimestampColumn(
  supabase: SupabaseClient,
  userId: string,
  timestampColumn: 'created_at' | 'uploaded_at',
  monthStartIso: string,
): Promise<Array<{ id: string; costUsd: number }> | null> {
  const { data, error } = await supabase
    .from('backups')
    .select('id, scrape_cost:data->scrape->>total_cost')
    .eq('user_id', userId)
    .eq('backup_type', 'snapshot')
    .eq('source', 'scrape')
    .gte(timestampColumn, monthStartIso)

  if (error) {
    if (isMissingColumnError(error, timestampColumn)) {
      return null
    }
    console.error(`[Twitter API Usage] Failed querying monthly spend via ${timestampColumn}:`, error)
    return []
  }

  return ((data || []) as ScrapeCostRow[])
    .map((row) => {
      const id = parseId(row.id)
      if (!id) return null
      return { id, costUsd: parseUsd(row.scrape_cost) }
    })
    .filter((row): row is { id: string; costUsd: number } => row !== null)
}

async function loadMonthlySpendWithoutTimestampColumn(
  supabase: SupabaseClient,
  userId: string,
  monthStartUtc: Date,
): Promise<Array<{ id: string; costUsd: number }>> {
  const { data, error } = await supabase
    .from('backups')
    .select('id, data')
    .eq('user_id', userId)
    .eq('backup_type', 'snapshot')
    .eq('source', 'scrape')

  if (error) {
    console.error('[Twitter API Usage] Fallback query failed:', error)
    return []
  }

  const monthStartMs = monthStartUtc.getTime()
  const costs: Array<{ id: string; costUsd: number }> = []

  for (const row of (data || []) as SnapshotBackupRow[]) {
    const id = parseId(row.id)
    if (!id) continue

    const payload = toRecord(row.data)
    const scrape = toRecord(payload.scrape)
    const scrapedAtRaw = scrape.scraped_at
    const scrapedAtMs =
      typeof scrapedAtRaw === 'string'
        ? Date.parse(scrapedAtRaw)
        : Number.NaN

    if (!Number.isFinite(scrapedAtMs) || scrapedAtMs < monthStartMs) {
      continue
    }

    costs.push({
      id,
      costUsd: parseUsd(scrape.total_cost),
    })
  }

  return costs
}

async function loadMonthlySnapshotBackupCosts(
  supabase: SupabaseClient,
  userId: string,
  monthStartUtc: Date,
): Promise<Array<{ id: string; costUsd: number }>> {
  const monthStartIso = monthStartUtc.toISOString()

  const createdAtRows = await loadMonthlySpendByTimestampColumn(
    supabase,
    userId,
    'created_at',
    monthStartIso,
  )
  if (createdAtRows !== null) {
    return createdAtRows
  }

  const uploadedAtRows = await loadMonthlySpendByTimestampColumn(
    supabase,
    userId,
    'uploaded_at',
    monthStartIso,
  )
  if (uploadedAtRows !== null) {
    return uploadedAtRows
  }

  console.warn(
    '[Twitter API Usage] Neither backups.created_at nor backups.uploaded_at is available. Using scraped_at JSON fallback.',
  )
  return loadMonthlySpendWithoutTimestampColumn(supabase, userId, monthStartUtc)
}

async function loadMonthlySnapshotJobCosts(
  supabase: SupabaseClient,
  userId: string,
  monthStartUtc: Date,
): Promise<SnapshotJobCostRow[]> {
  const monthStartIso = monthStartUtc.toISOString()

  const { data, error } = await supabase
    .from('backup_jobs')
    .select('result_backup_id, payload')
    .eq('user_id', userId)
    .eq('job_type', 'snapshot_scrape')
    .gte('created_at', monthStartIso)

  if (error) {
    if (isMissingRelationError(error, 'backup_jobs')) {
      // Backward-compatibility for environments that have not run jobs migration yet.
      return []
    }
    console.error('[Twitter API Usage] Failed querying snapshot jobs for monthly spend:', error)
    return []
  }

  return (data as SnapshotJobCostRow[]) || []
}

export function getCurrentMonthStartUtc(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

export async function calculateTwitterMonthlyApiSpendUsd(
  supabase: SupabaseClient,
  userId: string,
  monthStartUtc: Date = getCurrentMonthStartUtc(),
): Promise<number> {
  const [monthlyBackupCosts, monthlySnapshotJobs] = await Promise.all([
    loadMonthlySnapshotBackupCosts(supabase, userId, monthStartUtc),
    loadMonthlySnapshotJobCosts(supabase, userId, monthStartUtc),
  ])

  let jobCostTotal = 0
  const linkedBackupIds = new Set<string>()

  for (const job of monthlySnapshotJobs) {
    const jobCost = parseSnapshotJobCostUsd(job.payload)
    if (jobCost <= 0) continue
    jobCostTotal += jobCost
    for (const backupId of extractLinkedBackupIdsFromJob(job)) {
      linkedBackupIds.add(backupId)
    }
  }

  const unlinkedBackupCostTotal = monthlyBackupCosts.reduce((sum, row) => {
    if (linkedBackupIds.has(row.id)) return sum
    return sum + row.costUsd
  }, 0)

  return roundUsd(jobCostTotal + unlinkedBackupCostTotal)
}

export async function getTwitterApiUsageSummary(
  supabase: SupabaseClient,
  userId: string,
  monthStartUtc: Date = getCurrentMonthStartUtc(),
) {
  const spentUsd = await calculateTwitterMonthlyApiSpendUsd(supabase, userId, monthStartUtc)
  const limitUsd = TWITTER_SCRAPE_API_LIMITS.maxCostPerMonthUsd
  const remainingUsd = roundUsd(Math.max(0, limitUsd - spentUsd))

  return {
    monthStartIso: monthStartUtc.toISOString(),
    spentUsd,
    limitUsd: roundUsd(limitUsd),
    remainingUsd,
  }
}
