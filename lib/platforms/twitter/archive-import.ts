export type ArchiveImportSelection = {
  tweets: boolean
  followers: boolean
  following: boolean
  likes: boolean
  direct_messages: boolean
  media: boolean
}

export const DEFAULT_ARCHIVE_IMPORT_SELECTION: ArchiveImportSelection = {
  tweets: true,
  followers: true,
  following: true,
  likes: true,
  direct_messages: true,
  media: true,
}

const EMPTY_ARCHIVE_IMPORT_SELECTION: ArchiveImportSelection = {
  tweets: false,
  followers: false,
  following: false,
  likes: false,
  direct_messages: false,
  media: false,
}

export type ArchivePreviewStats = {
  tweets: number
  followers: number
  following: number
  likes: number
  dms: number
  media_files: number
}

export type ArchivePreviewData = {
  stats: ArchivePreviewStats
  available: ArchiveImportSelection
}

export type EncryptedDirectMessagesPayload = {
  version: number
  algorithm: 'AES-GCM'
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
  }
  payload: {
    iv_b64: string
    ciphertext_b64: string
  }
  wrapped_keys: {
    passphrase: {
      salt_b64: string
      iv_b64: string
      ciphertext_b64: string
    }
    recovery: {
      salt_b64: string
      iv_b64: string
      ciphertext_b64: string
    }
  }
  metadata: {
    conversation_count: number
    message_count: number
    encrypted_at: string
  }
}

export type DmEncryptionUploadMetadata = {
  encrypted_input_path: string
  conversation_count: number
  message_count: number
  version: number
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }
  return fallback
}

function parseCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }
  return 0
}

export function normalizeArchiveImportSelection(input: unknown): ArchiveImportSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_ARCHIVE_IMPORT_SELECTION }
  }

  const raw = input as Record<string, unknown>

  return {
    tweets: toBoolean(raw.tweets, DEFAULT_ARCHIVE_IMPORT_SELECTION.tweets),
    followers: toBoolean(raw.followers, DEFAULT_ARCHIVE_IMPORT_SELECTION.followers),
    following: toBoolean(raw.following, DEFAULT_ARCHIVE_IMPORT_SELECTION.following),
    likes: toBoolean(raw.likes, DEFAULT_ARCHIVE_IMPORT_SELECTION.likes),
    direct_messages: toBoolean(raw.direct_messages, DEFAULT_ARCHIVE_IMPORT_SELECTION.direct_messages),
    media: toBoolean(raw.media, DEFAULT_ARCHIVE_IMPORT_SELECTION.media),
  }
}

function normalizeArchiveImportAvailability(input: unknown): ArchiveImportSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...EMPTY_ARCHIVE_IMPORT_SELECTION }
  }

  const raw = input as Record<string, unknown>

  return {
    tweets: toBoolean(raw.tweets, EMPTY_ARCHIVE_IMPORT_SELECTION.tweets),
    followers: toBoolean(raw.followers, EMPTY_ARCHIVE_IMPORT_SELECTION.followers),
    following: toBoolean(raw.following, EMPTY_ARCHIVE_IMPORT_SELECTION.following),
    likes: toBoolean(raw.likes, EMPTY_ARCHIVE_IMPORT_SELECTION.likes),
    direct_messages: toBoolean(raw.direct_messages, EMPTY_ARCHIVE_IMPORT_SELECTION.direct_messages),
    media: toBoolean(raw.media, EMPTY_ARCHIVE_IMPORT_SELECTION.media),
  }
}

export function normalizeArchivePreviewData(input: unknown): ArchivePreviewData | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const rawStats = raw.stats
  const rawAvailable = raw.available
  if (!rawStats || typeof rawStats !== 'object' || Array.isArray(rawStats)) return null

  const statsRecord = rawStats as Record<string, unknown>

  return {
    stats: {
      tweets: parseCount(statsRecord.tweets),
      followers: parseCount(statsRecord.followers),
      following: parseCount(statsRecord.following),
      likes: parseCount(statsRecord.likes),
      dms: parseCount(statsRecord.dms),
      media_files: parseCount(statsRecord.media_files),
    },
    available: normalizeArchiveImportAvailability(rawAvailable),
  }
}

export function deriveDefaultArchiveImportSelection(available: ArchiveImportSelection): ArchiveImportSelection {
  return {
    tweets: available.tweets,
    followers: available.followers,
    following: available.following,
    likes: available.likes,
    direct_messages: available.direct_messages,
    media: available.media,
  }
}

export function hasSelectedArchiveImportCategory(selection: ArchiveImportSelection): boolean {
  return Object.values(selection).some(Boolean)
}

function parseString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeDmEncryptionUploadMetadata(input: unknown): DmEncryptionUploadMetadata | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const encryptedInputPath = parseString(raw.encrypted_input_path).trim()
  if (!encryptedInputPath) return null

  return {
    encrypted_input_path: encryptedInputPath,
    conversation_count: parseCount(raw.conversation_count),
    message_count: parseCount(raw.message_count),
    version: parseCount(raw.version) || 1,
  }
}

export function normalizeEncryptedDirectMessagesPayload(input: unknown): EncryptedDirectMessagesPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const payload = raw.payload
  const wrappedKeys = raw.wrapped_keys
  const metadata = raw.metadata
  const kdf = raw.kdf

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (!wrappedKeys || typeof wrappedKeys !== 'object' || Array.isArray(wrappedKeys)) return null
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  if (!kdf || typeof kdf !== 'object' || Array.isArray(kdf)) return null

  const payloadRecord = payload as Record<string, unknown>
  const wrappedKeysRecord = wrappedKeys as Record<string, unknown>
  const metadataRecord = metadata as Record<string, unknown>
  const kdfRecord = kdf as Record<string, unknown>
  const passphraseRecord =
    wrappedKeysRecord.passphrase && typeof wrappedKeysRecord.passphrase === 'object' && !Array.isArray(wrappedKeysRecord.passphrase)
      ? (wrappedKeysRecord.passphrase as Record<string, unknown>)
      : null
  const recoveryRecord =
    wrappedKeysRecord.recovery && typeof wrappedKeysRecord.recovery === 'object' && !Array.isArray(wrappedKeysRecord.recovery)
      ? (wrappedKeysRecord.recovery as Record<string, unknown>)
      : null

  if (!passphraseRecord || !recoveryRecord) return null

  const algorithm = parseString(raw.algorithm)
  if (algorithm !== 'AES-GCM') return null

  const kdfName = parseString(kdfRecord.name)
  const kdfHash = parseString(kdfRecord.hash)
  const kdfIterations = parseCount(kdfRecord.iterations)

  if (kdfName !== 'PBKDF2' || kdfHash !== 'SHA-256' || kdfIterations <= 0) return null

  const normalized: EncryptedDirectMessagesPayload = {
    version: parseCount(raw.version) || 1,
    algorithm: 'AES-GCM',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: kdfIterations,
    },
    payload: {
      iv_b64: parseString(payloadRecord.iv_b64),
      ciphertext_b64: parseString(payloadRecord.ciphertext_b64),
    },
    wrapped_keys: {
      passphrase: {
        salt_b64: parseString(passphraseRecord.salt_b64),
        iv_b64: parseString(passphraseRecord.iv_b64),
        ciphertext_b64: parseString(passphraseRecord.ciphertext_b64),
      },
      recovery: {
        salt_b64: parseString(recoveryRecord.salt_b64),
        iv_b64: parseString(recoveryRecord.iv_b64),
        ciphertext_b64: parseString(recoveryRecord.ciphertext_b64),
      },
    },
    metadata: {
      conversation_count: parseCount(metadataRecord.conversation_count),
      message_count: parseCount(metadataRecord.message_count),
      encrypted_at: parseString(metadataRecord.encrypted_at),
    },
  }

  if (!normalized.payload.iv_b64 || !normalized.payload.ciphertext_b64) return null
  if (!normalized.wrapped_keys.passphrase.salt_b64 || !normalized.wrapped_keys.passphrase.iv_b64 || !normalized.wrapped_keys.passphrase.ciphertext_b64) return null
  if (!normalized.wrapped_keys.recovery.salt_b64 || !normalized.wrapped_keys.recovery.iv_b64 || !normalized.wrapped_keys.recovery.ciphertext_b64) return null
  if (!normalized.metadata.encrypted_at) return null

  return normalized
}
