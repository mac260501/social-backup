type JsonRecord = Record<string, unknown>

type GuestRetention = {
  expiresAtIso: string
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

export function getGuestRetention(data: unknown): GuestRetention | null {
  const root = toRecord(data)
  const retention = toRecord(root.retention)
  const mode = typeof retention.mode === 'string' ? retention.mode : ''
  if (mode !== 'guest_30d') return null
  const expiresAtIso = typeof retention.expires_at === 'string' ? retention.expires_at : ''
  if (!expiresAtIso) return null
  const expiresAtMs = Date.parse(expiresAtIso)
  if (!Number.isFinite(expiresAtMs)) return null
  return { expiresAtIso }
}

export function isGuestBackupExpired(data: unknown, nowMs: number = Date.now()): boolean {
  const retention = getGuestRetention(data)
  if (!retention) return false
  const expiresAtMs = Date.parse(retention.expiresAtIso)
  if (!Number.isFinite(expiresAtMs)) return false
  return expiresAtMs <= nowMs
}

export function getGuestBackupDaysLeft(data: unknown, nowMs: number = Date.now()): number | null {
  const retention = getGuestRetention(data)
  if (!retention) return null
  const expiresAtMs = Date.parse(retention.expiresAtIso)
  if (!Number.isFinite(expiresAtMs)) return null
  const remainingMs = expiresAtMs - nowMs
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
}

export function clearGuestRetention(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const root = { ...(data as JsonRecord) }
  if (!('retention' in root)) return root
  delete root.retention
  return root
}
