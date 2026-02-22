import type { EncryptedArchiveChunk, EncryptedArchiveManifest } from '@/lib/platforms/twitter/encrypted-archive'

type InitResponse = {
  success: boolean
  sessionId?: string
  sessionPrefix?: string
  chunkSize?: number
  chunkCount?: number
  error?: string
}

type ChunkPresignResponse = {
  success: boolean
  uploadUrl?: string
  chunkPath?: string
  error?: string
}

type CompleteResponse = {
  success: boolean
  encryptedArchiveBytes?: number
  chunkCount?: number
  error?: string
}

type DiscardResponse = {
  success: boolean
  error?: string
}

type ChunkDownloadUrlResponse = {
  success: boolean
  downloadUrl?: string
  error?: string
}

type WorkerReadyPayload = {
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
}

type WorkerChunkPayload = {
  chunkIndex: number
  iv_b64: string
  plaintext_bytes: number
  ciphertext_bytes: number
  ciphertext: ArrayBuffer
}

type WorkerResponse =
  | {
      type: 'ready'
      requestId: number
      payload: WorkerReadyPayload
    }
  | {
      type: 'chunk-encrypted'
      requestId: number
      chunkIndex: number
      iv_b64: string
      plaintext_bytes: number
      ciphertext_bytes: number
      ciphertext: ArrayBuffer
    }
  | {
      type: 'disposed'
      requestId: number
    }
  | {
      type: 'error'
      requestId: number
      error: string
    }

type WorkerPendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export type EncryptedArchiveUploadProgress = {
  phase: 'initializing' | 'encrypting' | 'uploading' | 'finalizing'
  percent: number
  detail: string
}

export type EncryptedArchiveUploadResult =
  | {
      success: true
      manifest: EncryptedArchiveManifest
      encryptedArchiveBytes: number
    }
  | {
      success: false
      error: string
    }

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return Math.round(value)
}

function emitProgress(
  onProgress: ((progress: EncryptedArchiveUploadProgress) => void) | undefined,
  progress: EncryptedArchiveUploadProgress,
) {
  onProgress?.({
    ...progress,
    percent: clampPercent(progress.percent),
  })
}

function createArchiveEncryptionWorker() {
  return new Worker('/archive-encryption-worker.js')
}

function createWorkerBridge(worker: Worker) {
  let nextRequestId = 1
  const pending = new Map<number, WorkerPendingRequest>()

  const onMessage = (event: MessageEvent<WorkerResponse>) => {
    const payload = event.data
    const request = pending.get(payload.requestId)
    if (!request) return
    pending.delete(payload.requestId)

    if (payload.type === 'error') {
      request.reject(new Error(payload.error || 'Worker request failed.'))
      return
    }
    request.resolve(payload)
  }

  const onError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'Archive encryption worker failed.')
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  }

  worker.addEventListener('message', onMessage as EventListener)
  worker.addEventListener('error', onError as EventListener)

  const request = <T>(
    type: 'init' | 'encrypt-chunk' | 'dispose',
    payload: Record<string, unknown>,
    transferables?: Transferable[],
  ) =>
    new Promise<T>((resolve, reject) => {
      const requestId = nextRequestId
      nextRequestId += 1
      pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage(
        {
          requestId,
          type,
          ...payload,
        },
        transferables || [],
      )
    })

  const destroy = () => {
    worker.removeEventListener('message', onMessage as EventListener)
    worker.removeEventListener('error', onError as EventListener)
    worker.terminate()
  }

  return {
    request,
    destroy,
  }
}

async function initEncryptedArchiveUpload(params: {
  backupId: string
  fileName: string
  fileSize: number
  chunkSize?: number
  chunkCount: number
}): Promise<{ success: true; sessionPrefix: string; chunkSize: number; chunkCount: number } | { success: false; error: string }> {
  const response = await fetch('/api/platforms/twitter/encrypted-archive/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      backupId: params.backupId,
      fileName: params.fileName,
      fileSize: params.fileSize,
      chunkSize: params.chunkSize,
      chunkCount: params.chunkCount,
    }),
  })
  const payload = await readJsonSafe<InitResponse>(response)
  if (!response.ok || !payload?.success || !payload.sessionPrefix || !payload.chunkSize || !payload.chunkCount) {
    return {
      success: false,
      error: payload?.error || 'Failed to initialize encrypted archive upload.',
    }
  }
  return {
    success: true,
    sessionPrefix: payload.sessionPrefix,
    chunkSize: payload.chunkSize,
    chunkCount: payload.chunkCount,
  }
}

async function presignEncryptedArchiveChunk(params: {
  sessionPrefix: string
  chunkIndex: number
  chunkSize: number
}): Promise<{ success: true; uploadUrl: string; chunkPath: string } | { success: false; error: string }> {
  const response = await fetch('/api/platforms/twitter/encrypted-archive/chunk/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const payload = await readJsonSafe<ChunkPresignResponse>(response)
  if (!response.ok || !payload?.success || !payload.uploadUrl || !payload.chunkPath) {
    return {
      success: false,
      error: payload?.error || 'Failed to create encrypted chunk upload URL.',
    }
  }
  return {
    success: true,
    uploadUrl: payload.uploadUrl,
    chunkPath: payload.chunkPath,
  }
}

async function completeEncryptedArchiveUpload(params: {
  backupId: string
  manifest: EncryptedArchiveManifest
}): Promise<{ success: true; encryptedArchiveBytes: number } | { success: false; error: string }> {
  const response = await fetch('/api/platforms/twitter/encrypted-archive/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const payload = await readJsonSafe<CompleteResponse>(response)
  if (!response.ok || !payload?.success || typeof payload.encryptedArchiveBytes !== 'number') {
    return {
      success: false,
      error: payload?.error || 'Failed to finalize encrypted archive upload.',
    }
  }
  return {
    success: true,
    encryptedArchiveBytes: payload.encryptedArchiveBytes,
  }
}

async function discardEncryptedArchiveChunks(chunkPaths: string[]): Promise<void> {
  if (chunkPaths.length === 0) return
  const response = await fetch('/api/platforms/twitter/encrypted-archive/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunkPaths,
    }),
  })
  const payload = await readJsonSafe<DiscardResponse>(response)
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Failed to discard encrypted archive chunks.')
  }
}

export async function createEncryptedArchiveChunkDownloadUrl(storagePath: string): Promise<string> {
  const response = await fetch('/api/platforms/twitter/encrypted-archive/chunk/download-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storagePath,
    }),
  })
  const payload = await readJsonSafe<ChunkDownloadUrlResponse>(response)
  if (!response.ok || !payload?.success || !payload.downloadUrl) {
    throw new Error(payload?.error || 'Failed to create encrypted archive chunk download URL.')
  }
  return payload.downloadUrl
}

export async function encryptAndUploadArchiveInChunks(params: {
  backupId: string
  file: File
  passphrase: string
  recoveryKey: string
  chunkSize?: number
  onProgress?: (progress: EncryptedArchiveUploadProgress) => void
}): Promise<EncryptedArchiveUploadResult> {
  const chunkSize = params.chunkSize && params.chunkSize > 0 ? Math.floor(params.chunkSize) : 5 * 1024 * 1024
  const requestedChunkCount = Math.max(1, Math.ceil(params.file.size / chunkSize))

  emitProgress(params.onProgress, {
    phase: 'initializing',
    percent: 2,
    detail: 'Preparing encrypted archive session...',
  })

  const initResult = await initEncryptedArchiveUpload({
    backupId: params.backupId,
    fileName: params.file.name,
    fileSize: params.file.size,
    chunkSize,
    chunkCount: requestedChunkCount,
  })
  if (!initResult.success) {
    return { success: false, error: initResult.error }
  }

  const worker = createArchiveEncryptionWorker()
  const workerBridge = createWorkerBridge(worker)
  const uploadedChunkPaths: string[] = []

  try {
    const workerReady = (await workerBridge.request<{
      type: 'ready'
      payload: WorkerReadyPayload
    }>('init', {
      passphrase: params.passphrase,
      recoveryKey: params.recoveryKey,
    })).payload

    const chunkItems: EncryptedArchiveChunk[] = []
    const totalChunks = initResult.chunkCount

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      emitProgress(params.onProgress, {
        phase: 'encrypting',
        percent: 5 + Math.round((chunkIndex / Math.max(1, totalChunks)) * 35),
        detail: `Encrypting chunk ${chunkIndex + 1}/${totalChunks}...`,
      })

      const start = chunkIndex * initResult.chunkSize
      const end = Math.min(params.file.size, start + initResult.chunkSize)
      const chunkArrayBuffer = await params.file.slice(start, end).arrayBuffer()

      const encryptedChunkResult = (await workerBridge.request<{
        type: 'chunk-encrypted'
        chunkIndex: number
        iv_b64: string
        plaintext_bytes: number
        ciphertext_bytes: number
        ciphertext: ArrayBuffer
      }>(
        'encrypt-chunk',
        {
          chunkIndex,
          plaintext: chunkArrayBuffer,
        },
        [chunkArrayBuffer],
      )) as WorkerChunkPayload

      const presignResult = await presignEncryptedArchiveChunk({
        sessionPrefix: initResult.sessionPrefix,
        chunkIndex,
        chunkSize: encryptedChunkResult.ciphertext_bytes,
      })
      if (!presignResult.success) {
        throw new Error(presignResult.error)
      }

      emitProgress(params.onProgress, {
        phase: 'uploading',
        percent: 40 + Math.round(((chunkIndex + 1) / Math.max(1, totalChunks)) * 50),
        detail: `Uploading encrypted chunk ${chunkIndex + 1}/${totalChunks}...`,
      })

      const uploadResponse = await fetch(presignResult.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: encryptedChunkResult.ciphertext,
      })
      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload encrypted chunk ${chunkIndex + 1} (status ${uploadResponse.status}).`)
      }

      uploadedChunkPaths.push(presignResult.chunkPath)
      chunkItems.push({
        index: chunkIndex,
        storage_path: presignResult.chunkPath,
        iv_b64: encryptedChunkResult.iv_b64,
        plaintext_bytes: encryptedChunkResult.plaintext_bytes,
        ciphertext_bytes: encryptedChunkResult.ciphertext_bytes,
      })
    }

    emitProgress(params.onProgress, {
      phase: 'finalizing',
      percent: 96,
      detail: 'Finalizing encrypted archive metadata...',
    })

    const manifest: EncryptedArchiveManifest = {
      version: workerReady.version,
      algorithm: workerReady.algorithm,
      kdf: workerReady.kdf,
      wrapped_keys: workerReady.wrapped_keys,
      file: {
        file_name: params.file.name,
        original_bytes: params.file.size,
        chunk_bytes: initResult.chunkSize,
        chunk_count: totalChunks,
        encrypted_at: new Date().toISOString(),
      },
      chunks: chunkItems,
    }

    const completeResult = await completeEncryptedArchiveUpload({
      backupId: params.backupId,
      manifest,
    })
    if (!completeResult.success) {
      throw new Error(completeResult.error)
    }

    emitProgress(params.onProgress, {
      phase: 'finalizing',
      percent: 100,
      detail: 'Encrypted archive storage complete.',
    })

    return {
      success: true,
      manifest,
      encryptedArchiveBytes: completeResult.encryptedArchiveBytes,
    }
  } catch (error) {
    try {
      await discardEncryptedArchiveChunks(uploadedChunkPaths)
    } catch (discardError) {
      console.warn('[Encrypted Archive Upload] Failed to clean up uploaded chunks:', discardError)
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to store encrypted archive.',
    }
  } finally {
    try {
      await workerBridge.request('dispose', {})
    } catch {
      // no-op
    }
    workerBridge.destroy()
  }
}
