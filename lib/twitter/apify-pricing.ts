import { TWITTER_SCRAPE_API_LIMITS } from '@/lib/platforms/twitter/limits'

function clampNonNegativeNumber(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value
}

export function roundUsd(value: number): number {
  return Math.round(clampNonNegativeNumber(value) * 100) / 100
}

export function estimateApifyTimelineCostUsd(timelineItems: number): number {
  const safeItems = Math.max(0, Math.floor(clampNonNegativeNumber(timelineItems)))
  if (safeItems <= 0) return 0

  const extraItems = Math.max(0, safeItems - TWITTER_SCRAPE_API_LIMITS.profileIncludedItems)
  const extraItemsCost = extraItems * TWITTER_SCRAPE_API_LIMITS.profileExtraItemUsd

  return roundUsd(TWITTER_SCRAPE_API_LIMITS.profileQueryBaseUsd + extraItemsCost)
}

export function estimateApifyTimelineExtraItemsCostUsd(timelineItems: number): number {
  const safeItems = Math.max(0, Math.floor(clampNonNegativeNumber(timelineItems)))
  if (safeItems <= 0) return 0
  const extraItems = Math.max(0, safeItems - TWITTER_SCRAPE_API_LIMITS.profileIncludedItems)
  return roundUsd(extraItems * TWITTER_SCRAPE_API_LIMITS.profileExtraItemUsd)
}

export function estimateApifySocialGraphCostUsd(socialGraphItems: number): number {
  const safeItems = Math.max(0, Math.floor(clampNonNegativeNumber(socialGraphItems)))
  if (safeItems <= 0) return 0
  return roundUsd(safeItems * TWITTER_SCRAPE_API_LIMITS.socialGraphItemUsd)
}

export function maxApifySocialGraphItemsForBudget(budgetUsd: number): number {
  const safeBudget = clampNonNegativeNumber(budgetUsd)
  if (safeBudget <= 0) return 0
  if (TWITTER_SCRAPE_API_LIMITS.socialGraphItemUsd <= 0) return 0
  return Math.max(0, Math.floor(safeBudget / TWITTER_SCRAPE_API_LIMITS.socialGraphItemUsd))
}

export function maxApifyTimelineItemsForBudget(budgetUsd: number): number {
  const safeBudget = clampNonNegativeNumber(budgetUsd)
  if (safeBudget <= 0) return 0

  const base = TWITTER_SCRAPE_API_LIMITS.profileQueryBaseUsd
  const included = Math.max(1, Math.floor(TWITTER_SCRAPE_API_LIMITS.profileIncludedItems))
  const extraPerItem = TWITTER_SCRAPE_API_LIMITS.profileExtraItemUsd

  if (base <= 0) {
    if (extraPerItem <= 0) return Number.MAX_SAFE_INTEGER
    return Math.max(0, Math.floor(safeBudget / extraPerItem))
  }

  if (safeBudget < base) return 0
  if (extraPerItem <= 0) return Number.MAX_SAFE_INTEGER

  const extraItems = Math.max(0, Math.floor((safeBudget - base) / extraPerItem))
  return included + extraItems
}
