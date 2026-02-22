const RECOVERY_KEY_GROUP_COUNT = 6
const RECOVERY_KEY_GROUP_LENGTH = 4
const PBKDF2_ITERATIONS = 210000
const AES_GCM_IV_BYTES = 12

let workerState = null

function ensureCryptoSupport() {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('This browser does not support secure encryption features.')
  }
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function sanitizeRecoveryKey(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function normalizeRecoveryKey(value) {
  const compact = sanitizeRecoveryKey(value)
  const expectedLength = RECOVERY_KEY_GROUP_COUNT * RECOVERY_KEY_GROUP_LENGTH
  if (compact.length !== expectedLength) {
    throw new Error('Recovery key format is invalid.')
  }
  return compact
}

async function importAesKey(rawKey, usage) {
  ensureCryptoSupport()
  return crypto.subtle.importKey('raw', toArrayBuffer(rawKey), { name: 'AES-GCM' }, false, usage)
}

async function deriveWrapKey(secret, salt, iterations) {
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

async function encryptBytesWithAesKey(key, plaintext) {
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

function postError(requestId, error) {
  self.postMessage({
    type: 'error',
    requestId,
    error: error instanceof Error ? error.message : 'Unexpected worker error.',
  })
}

async function handleInit(message) {
  const passphrase = String(message.passphrase || '').trim()
  if (!passphrase) {
    throw new Error('Passphrase is required.')
  }
  const recoveryCompact = normalizeRecoveryKey(message.recoveryKey)

  const dataKeyBytes = randomBytes(32)
  const dataKey = await importAesKey(dataKeyBytes, ['encrypt'])
  const passphraseSalt = randomBytes(16)
  const recoverySalt = randomBytes(16)
  const passphraseWrapKey = await deriveWrapKey(passphrase, passphraseSalt, PBKDF2_ITERATIONS)
  const recoveryWrapKey = await deriveWrapKey(recoveryCompact, recoverySalt, PBKDF2_ITERATIONS)
  const passphraseWrapped = await encryptBytesWithAesKey(passphraseWrapKey, dataKeyBytes)
  const recoveryWrapped = await encryptBytesWithAesKey(recoveryWrapKey, dataKeyBytes)

  workerState = {
    dataKey,
    metadata: {
      version: 1,
      algorithm: 'AES-GCM',
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: PBKDF2_ITERATIONS,
      },
      wrapped_keys: {
        passphrase: {
          salt_b64: bytesToBase64(passphraseSalt),
          iv_b64: bytesToBase64(passphraseWrapped.iv),
          ciphertext_b64: bytesToBase64(passphraseWrapped.ciphertext),
        },
        recovery: {
          salt_b64: bytesToBase64(recoverySalt),
          iv_b64: bytesToBase64(recoveryWrapped.iv),
          ciphertext_b64: bytesToBase64(recoveryWrapped.ciphertext),
        },
      },
    },
  }

  self.postMessage({
    type: 'ready',
    requestId: message.requestId,
    payload: workerState.metadata,
  })
}

async function handleEncryptChunk(message) {
  if (!workerState || !workerState.dataKey) {
    throw new Error('Archive encryption worker is not initialized.')
  }

  const plaintext =
    message.plaintext instanceof ArrayBuffer
      ? new Uint8Array(message.plaintext)
      : message.plaintext instanceof Uint8Array
        ? message.plaintext
        : new Uint8Array(0)
  const encrypted = await encryptBytesWithAesKey(workerState.dataKey, plaintext)

  self.postMessage(
    {
      type: 'chunk-encrypted',
      requestId: message.requestId,
      chunkIndex: message.chunkIndex,
      iv_b64: bytesToBase64(encrypted.iv),
      plaintext_bytes: plaintext.byteLength,
      ciphertext_bytes: encrypted.ciphertext.byteLength,
      ciphertext: encrypted.ciphertext.buffer,
    },
    [encrypted.ciphertext.buffer],
  )
}

self.onmessage = async (event) => {
  const message = event.data || {}
  const requestId = message.requestId

  try {
    if (message.type === 'init') {
      await handleInit(message)
      return
    }

    if (message.type === 'encrypt-chunk') {
      await handleEncryptChunk(message)
      return
    }

    if (message.type === 'dispose') {
      workerState = null
      self.postMessage({ type: 'disposed', requestId })
      return
    }

    throw new Error('Unsupported worker action.')
  } catch (error) {
    postError(requestId, error)
  }
}
