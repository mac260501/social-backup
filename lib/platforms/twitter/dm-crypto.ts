import type { EncryptedDirectMessagesPayload } from '@/lib/platforms/twitter/archive-import'

const RECOVERY_KEY_GROUP_COUNT = 6
const RECOVERY_KEY_GROUP_LENGTH = 4
const RECOVERY_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT_PBKDF2_ITERATIONS = 210_000
const AES_GCM_IV_BYTES = 12

function ensureCryptoSupport() {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('This browser does not support secure encryption features.')
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
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

function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
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

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  ensureCryptoSupport()
  return crypto.subtle.importKey('raw', toArrayBuffer(rawKey), { name: 'AES-GCM' }, false, usage)
}

async function deriveWrapKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  ensureCryptoSupport()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(utf8ToBytes(secret)),
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

async function encryptBytesWithAesKey(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  ensureCryptoSupport()
  const iv = randomBytes(AES_GCM_IV_BYTES)
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(plaintext),
  )

  return {
    iv,
    ciphertext: new Uint8Array(ciphertextBuffer),
  }
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

function countDmMessages(directMessages: unknown[]): { conversationCount: number; messageCount: number } {
  const conversationCount = directMessages.length
  const messageCount = directMessages.reduce<number>((sum, entry) => {
    if (!entry || typeof entry !== 'object') return sum
    const messages = (entry as { messages?: unknown }).messages
    if (!Array.isArray(messages)) return sum
    return sum + messages.length
  }, 0)

  return {
    conversationCount,
    messageCount,
  }
}

export function generateRecoveryKey(): string {
  ensureCryptoSupport()

  const totalChars = RECOVERY_KEY_GROUP_COUNT * RECOVERY_KEY_GROUP_LENGTH
  const bytes = randomBytes(totalChars)
  let compact = ''

  for (let i = 0; i < totalChars; i += 1) {
    compact += RECOVERY_KEY_ALPHABET[bytes[i] % RECOVERY_KEY_ALPHABET.length]
  }

  return formatRecoveryKey(compact)
}

export function normalizeRecoveryKey(value: string): string {
  const compact = sanitizeRecoveryKey(value)
  const expectedLength = RECOVERY_KEY_GROUP_COUNT * RECOVERY_KEY_GROUP_LENGTH
  if (compact.length !== expectedLength) {
    throw new Error('Recovery key format is invalid.')
  }
  return formatRecoveryKey(compact)
}

export async function encryptDirectMessagesForClientStorage(params: {
  directMessages: unknown[]
  passphrase: string
  recoveryKey: string
}): Promise<EncryptedDirectMessagesPayload> {
  const passphrase = params.passphrase.trim()
  if (!passphrase) {
    throw new Error('Passphrase is required to encrypt direct messages.')
  }

  const normalizedRecoveryKey = normalizeRecoveryKey(params.recoveryKey)
  const recoveryKeySecret = sanitizeRecoveryKey(normalizedRecoveryKey)

  const { conversationCount, messageCount } = countDmMessages(params.directMessages)
  const directMessagesJson = JSON.stringify(params.directMessages)
  const payloadBytes = utf8ToBytes(directMessagesJson)

  const dataKeyBytes = randomBytes(32)
  const dataKey = await importAesKey(dataKeyBytes, ['encrypt'])

  const payloadEncryption = await encryptBytesWithAesKey(dataKey, payloadBytes)

  const passphraseSalt = randomBytes(16)
  const recoverySalt = randomBytes(16)
  const passphraseWrapKey = await deriveWrapKey(passphrase, passphraseSalt, DEFAULT_PBKDF2_ITERATIONS)
  const recoveryWrapKey = await deriveWrapKey(recoveryKeySecret, recoverySalt, DEFAULT_PBKDF2_ITERATIONS)

  const passphraseWrappedDataKey = await encryptBytesWithAesKey(passphraseWrapKey, dataKeyBytes)
  const recoveryWrappedDataKey = await encryptBytesWithAesKey(recoveryWrapKey, dataKeyBytes)

  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: DEFAULT_PBKDF2_ITERATIONS,
    },
    payload: {
      iv_b64: bytesToBase64(payloadEncryption.iv),
      ciphertext_b64: bytesToBase64(payloadEncryption.ciphertext),
    },
    wrapped_keys: {
      passphrase: {
        salt_b64: bytesToBase64(passphraseSalt),
        iv_b64: bytesToBase64(passphraseWrappedDataKey.iv),
        ciphertext_b64: bytesToBase64(passphraseWrappedDataKey.ciphertext),
      },
      recovery: {
        salt_b64: bytesToBase64(recoverySalt),
        iv_b64: bytesToBase64(recoveryWrappedDataKey.iv),
        ciphertext_b64: bytesToBase64(recoveryWrappedDataKey.ciphertext),
      },
    },
    metadata: {
      conversation_count: conversationCount,
      message_count: messageCount,
      encrypted_at: new Date().toISOString(),
    },
  }
}

async function decryptDirectMessagesWithSecret(params: {
  payload: EncryptedDirectMessagesPayload
  wrappedKeyType: 'passphrase' | 'recovery'
  secret: string
}): Promise<unknown[]> {
  const { payload, wrappedKeyType } = params
  const secret = params.secret.trim()
  if (!secret) {
    throw new Error('Missing decryption secret.')
  }

  const wrappedKey = payload.wrapped_keys[wrappedKeyType]
  const iterations = payload.kdf.iterations

  const saltBytes = base64ToBytes(wrappedKey.salt_b64)
  const wrappedKeyIv = base64ToBytes(wrappedKey.iv_b64)
  const wrappedKeyCiphertext = base64ToBytes(wrappedKey.ciphertext_b64)

  const wrapKey = await deriveWrapKey(secret, saltBytes, iterations)
  const rawDataKey = await decryptBytesWithAesKey(wrapKey, wrappedKeyCiphertext, wrappedKeyIv)

  const dataKey = await importAesKey(rawDataKey, ['decrypt'])
  const payloadIv = base64ToBytes(payload.payload.iv_b64)
  const payloadCiphertext = base64ToBytes(payload.payload.ciphertext_b64)
  const plaintextBytes = await decryptBytesWithAesKey(dataKey, payloadCiphertext, payloadIv)

  const parsed = JSON.parse(bytesToUtf8(plaintextBytes)) as unknown
  return Array.isArray(parsed) ? parsed : []
}

export async function decryptDirectMessagesWithPassphrase(params: {
  payload: EncryptedDirectMessagesPayload
  passphrase: string
}): Promise<unknown[]> {
  try {
    return await decryptDirectMessagesWithSecret({
      payload: params.payload,
      wrappedKeyType: 'passphrase',
      secret: params.passphrase,
    })
  } catch {
    throw new Error('Unable to decrypt chats with this passphrase.')
  }
}

export async function decryptDirectMessagesWithRecoveryKey(params: {
  payload: EncryptedDirectMessagesPayload
  recoveryKey: string
}): Promise<unknown[]> {
  let normalizedRecoveryKey = ''
  try {
    normalizedRecoveryKey = normalizeRecoveryKey(params.recoveryKey)
  } catch {
    throw new Error('Recovery key format is invalid.')
  }

  try {
    return await decryptDirectMessagesWithSecret({
      payload: params.payload,
      wrappedKeyType: 'recovery',
      secret: sanitizeRecoveryKey(normalizedRecoveryKey),
    })
  } catch {
    throw new Error('Unable to decrypt chats with this recovery key.')
  }
}
