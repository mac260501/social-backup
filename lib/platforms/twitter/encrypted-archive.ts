export type EncryptedArchiveChunk = {
  index: number
  storage_path: string
  iv_b64: string
  plaintext_bytes: number
  ciphertext_bytes: number
}

export type EncryptedArchiveManifest = {
  version: number
  algorithm: 'AES-GCM'
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
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
  file: {
    file_name: string
    original_bytes: number
    chunk_bytes: number
    chunk_count: number
    encrypted_at: string
  }
  chunks: EncryptedArchiveChunk[]
}

const RECOVERY_KEY_GROUP_COUNT = 6
const RECOVERY_KEY_GROUP_LENGTH = 4

function ensureCryptoSupport() {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('This browser does not support secure encryption features.')
  }
}

function parseCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }
  return 0
}

function parseString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sanitizeRecoveryKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function formatRecoveryKey(compactKey: string): string {
  const groups: string[] = []
  for (let i = 0; i < RECOVERY_KEY_GROUP_COUNT; i += 1) {
    const start = i * RECOVERY_KEY_GROUP_LENGTH
    groups.push(compactKey.slice(start, start + RECOVERY_KEY_GROUP_LENGTH))
  }
  return groups.join('-')
}

export function normalizeArchiveRecoveryKey(value: string): string {
  const compact = sanitizeRecoveryKey(value)
  const expectedLength = RECOVERY_KEY_GROUP_COUNT * RECOVERY_KEY_GROUP_LENGTH
  if (compact.length !== expectedLength) {
    throw new Error('Recovery key format is invalid.')
  }
  return formatRecoveryKey(compact)
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim()
  if (!normalized) return new Uint8Array()
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  ensureCryptoSupport()
  return crypto.subtle.importKey('raw', toArrayBuffer(rawKey), { name: 'AES-GCM' }, false, usage)
}

async function deriveWrapKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  ensureCryptoSupport()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(secret)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function decryptBytesWithAesKey(key: CryptoKey, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  ensureCryptoSupport()
  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(ciphertext),
  )
  return new Uint8Array(plaintextBuffer)
}

export function normalizeEncryptedArchiveManifest(input: unknown): EncryptedArchiveManifest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const file = raw.file
  const kdf = raw.kdf
  const wrappedKeys = raw.wrapped_keys
  const chunks = raw.chunks

  if (!file || typeof file !== 'object' || Array.isArray(file)) return null
  if (!kdf || typeof kdf !== 'object' || Array.isArray(kdf)) return null
  if (!wrappedKeys || typeof wrappedKeys !== 'object' || Array.isArray(wrappedKeys)) return null
  if (!Array.isArray(chunks)) return null

  const fileRecord = file as Record<string, unknown>
  const kdfRecord = kdf as Record<string, unknown>
  const wrappedRecord = wrappedKeys as Record<string, unknown>

  const passphraseRecord =
    wrappedRecord.passphrase && typeof wrappedRecord.passphrase === 'object' && !Array.isArray(wrappedRecord.passphrase)
      ? (wrappedRecord.passphrase as Record<string, unknown>)
      : null
  const recoveryRecord =
    wrappedRecord.recovery && typeof wrappedRecord.recovery === 'object' && !Array.isArray(wrappedRecord.recovery)
      ? (wrappedRecord.recovery as Record<string, unknown>)
      : null

  if (!passphraseRecord || !recoveryRecord) return null

  const algorithm = parseString(raw.algorithm)
  if (algorithm !== 'AES-GCM') return null
  const kdfName = parseString(kdfRecord.name)
  const kdfHash = parseString(kdfRecord.hash)
  const kdfIterations = parseCount(kdfRecord.iterations)
  if (kdfName !== 'PBKDF2' || kdfHash !== 'SHA-256' || kdfIterations <= 0) return null

  const normalizedChunks = chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) return null
      const chunkRecord = chunk as Record<string, unknown>
      const storagePath = parseString(chunkRecord.storage_path).trim()
      const iv = parseString(chunkRecord.iv_b64).trim()
      const index = parseCount(chunkRecord.index)
      const plaintextBytes = parseCount(chunkRecord.plaintext_bytes)
      const ciphertextBytes = parseCount(chunkRecord.ciphertext_bytes)
      if (!storagePath || !iv) return null
      return {
        index,
        storage_path: storagePath,
        iv_b64: iv,
        plaintext_bytes: plaintextBytes,
        ciphertext_bytes: ciphertextBytes,
      } satisfies EncryptedArchiveChunk
    })
    .filter((chunk): chunk is EncryptedArchiveChunk => Boolean(chunk))
    .sort((a, b) => a.index - b.index)

  const normalized: EncryptedArchiveManifest = {
    version: parseCount(raw.version) || 1,
    algorithm: 'AES-GCM',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: kdfIterations,
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
    file: {
      file_name: parseString(fileRecord.file_name).trim(),
      original_bytes: parseCount(fileRecord.original_bytes),
      chunk_bytes: parseCount(fileRecord.chunk_bytes),
      chunk_count: parseCount(fileRecord.chunk_count),
      encrypted_at: parseString(fileRecord.encrypted_at),
    },
    chunks: normalizedChunks,
  }

  if (!normalized.file.file_name || !normalized.file.encrypted_at) return null
  if (normalized.file.chunk_count <= 0 || normalized.chunks.length === 0) return null
  if (!normalized.wrapped_keys.passphrase.salt_b64 || !normalized.wrapped_keys.passphrase.iv_b64 || !normalized.wrapped_keys.passphrase.ciphertext_b64) return null
  if (!normalized.wrapped_keys.recovery.salt_b64 || !normalized.wrapped_keys.recovery.iv_b64 || !normalized.wrapped_keys.recovery.ciphertext_b64) return null

  return normalized
}

async function unlockEncryptedArchiveDataKey(params: {
  manifest: EncryptedArchiveManifest
  mode: 'passphrase' | 'recovery'
  secret: string
}): Promise<CryptoKey> {
  const secret = params.secret.trim()
  if (!secret) {
    throw new Error('Missing decryption secret.')
  }
  const wrapped = params.manifest.wrapped_keys[params.mode]
  const iterations = params.manifest.kdf.iterations
  const wrapKey = await deriveWrapKey(secret, base64ToBytes(wrapped.salt_b64), iterations)
  const rawDataKey = await decryptBytesWithAesKey(
    wrapKey,
    base64ToBytes(wrapped.ciphertext_b64),
    base64ToBytes(wrapped.iv_b64),
  )
  return importAesKey(rawDataKey, ['decrypt'])
}

export async function unlockEncryptedArchiveDataKeyWithPassphrase(params: {
  manifest: EncryptedArchiveManifest
  passphrase: string
}): Promise<CryptoKey> {
  try {
    return await unlockEncryptedArchiveDataKey({
      manifest: params.manifest,
      mode: 'passphrase',
      secret: params.passphrase,
    })
  } catch {
    throw new Error('Unable to decrypt archive key with this passphrase.')
  }
}

export async function unlockEncryptedArchiveDataKeyWithRecoveryKey(params: {
  manifest: EncryptedArchiveManifest
  recoveryKey: string
}): Promise<CryptoKey> {
  let normalizedRecoveryKey = ''
  try {
    normalizedRecoveryKey = normalizeArchiveRecoveryKey(params.recoveryKey)
  } catch {
    throw new Error('Recovery key format is invalid.')
  }

  try {
    return await unlockEncryptedArchiveDataKey({
      manifest: params.manifest,
      mode: 'recovery',
      secret: sanitizeRecoveryKey(normalizedRecoveryKey),
    })
  } catch {
    throw new Error('Unable to decrypt archive key with this recovery key.')
  }
}

export async function decryptEncryptedArchiveChunkWithDataKey(params: {
  dataKey: CryptoKey
  ciphertext: ArrayBuffer | Uint8Array
  ivBase64: string
}): Promise<Uint8Array> {
  const ciphertext =
    params.ciphertext instanceof Uint8Array ? params.ciphertext : new Uint8Array(params.ciphertext)
  return decryptBytesWithAesKey(params.dataKey, ciphertext, base64ToBytes(params.ivBase64))
}
