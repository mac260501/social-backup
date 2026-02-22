import {
  DEFAULT_ARCHIVE_IMPORT_SELECTION,
  type DmEncryptionUploadMetadata,
  type EncryptedDirectMessagesPayload,
  normalizeArchiveImportSelection,
  type ArchiveImportSelection,
} from '@/lib/platforms/twitter/archive-import'

export type DirectUploadJobSummary = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  message?: string | null
}

export type DirectUploadResult = {
  success: boolean
  message?: string
  error?: string
  job?: DirectUploadJobSummary
}

export type DirectUploadProgress = {
  phase: 'preparing' | 'uploading' | 'finalizing' | 'processing'
  percent: number
  uploadedBytes: number
  totalBytes: number
  detail?: string
}

export type StagedArchiveUploadResult = {
  success: boolean
  stagedInputPath?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  message?: string
  error?: string
}

type PresignResponse = {
  success: boolean
  uploadUrl?: string
  stagedInputPath?: string
  error?: string
}

type MultipartInitResponse = {
  success: boolean
  uploadId?: string
  stagedInputPath?: string
  partSize?: number
  totalParts?: number
  error?: string
}

type MultipartSignResponse = {
  success: boolean
  uploadUrl?: string
  error?: string
}

type MultipartCompleteResponse = {
  success: boolean
  stagedInputPath?: string
  fileSize?: number
  message?: string
  error?: string
}

type DmEncryptionPresignResponse = {
  success: boolean
  uploadUrl?: string
  stagedInputPath?: string
  error?: string
}

const MULTIPART_MIN_BYTES = 24 * 1024 * 1024
const UPLOAD_PROGRESS_MIN = 5
const UPLOAD_PROGRESS_MAX = 92
const FINALIZING_PROGRESS = 96
const DEFAULT_UPLOAD_ERROR =
  'Failed to upload archive. Confirm R2 CORS allows PUT from your app domain and retry.'

function readErrorFallback(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return Math.round(value)
}

function uploadProgressPercent(uploadedBytes: number, totalBytes: number) {
  if (!totalBytes || totalBytes <= 0) return UPLOAD_PROGRESS_MIN
  const ratio = Math.max(0, Math.min(1, uploadedBytes / totalBytes))
  return clampPercent(UPLOAD_PROGRESS_MIN + ratio * (UPLOAD_PROGRESS_MAX - UPLOAD_PROGRESS_MIN))
}

function emitProgress(
  onProgress: ((progress: DirectUploadProgress) => void) | undefined,
  progress: DirectUploadProgress,
) {
  onProgress?.({
    ...progress,
    percent: clampPercent(progress.percent),
  })
}

async function uploadBlobViaXhr(params: {
  url: string
  body: Blob
  onProgress?: (loadedBytes: number, totalBytes: number) => void
}): Promise<{ status: number; ok: boolean; etag: string | null }> {
  const { url, body, onProgress } = params

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(event.loaded, event.total)
    }

    xhr.onerror = () => reject(new Error('Network error while uploading archive chunk'))
    xhr.onabort = () => reject(new Error('Archive upload aborted'))
    xhr.onload = () => {
      const status = xhr.status
      const etag = xhr.getResponseHeader('ETag')
      resolve({
        status,
        ok: status >= 200 && status < 300,
        etag,
      })
    }

    xhr.send(body)
  })
}

async function uploadSinglePartToStaging(params: {
  file: File
  onProgress?: (progress: DirectUploadProgress) => void
}): Promise<StagedArchiveUploadResult> {
  const { file, onProgress } = params

  emitProgress(onProgress, {
    phase: 'preparing',
    percent: 2,
    uploadedBytes: 0,
    totalBytes: file.size,
    detail: 'Preparing secure upload URL...',
  })

  const presignResponse = await fetch('/api/platforms/twitter/upload-archive/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    }),
  })

  const presignData = await readJsonSafe<PresignResponse>(presignResponse)
  if (!presignResponse.ok || !presignData?.success || !presignData.uploadUrl || !presignData.stagedInputPath) {
    throw new Error(presignData?.error || 'Failed to create upload URL')
  }

  emitProgress(onProgress, {
    phase: 'uploading',
    percent: UPLOAD_PROGRESS_MIN,
    uploadedBytes: 0,
    totalBytes: file.size,
    detail: 'Uploading archive...',
  })

  const putResponse = await uploadBlobViaXhr({
    url: presignData.uploadUrl,
    body: file,
    onProgress: (loadedBytes) => {
      emitProgress(onProgress, {
        phase: 'uploading',
        percent: uploadProgressPercent(loadedBytes, file.size),
        uploadedBytes: loadedBytes,
        totalBytes: file.size,
        detail: 'Uploading archive...',
      })
    },
  })

  if (!putResponse.ok) {
    throw new Error(`Failed to upload file to storage (status ${putResponse.status}).`)
  }

  emitProgress(onProgress, {
    phase: 'processing',
    percent: 100,
    uploadedBytes: file.size,
    totalBytes: file.size,
    detail: 'Upload complete. Ready to review archive contents.',
  })

  return {
    success: true,
    stagedInputPath: presignData.stagedInputPath,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    message: 'Archive uploaded. Review archive contents before importing.',
  }
}

async function uploadMultipartToStaging(params: {
  file: File
  onProgress?: (progress: DirectUploadProgress) => void
}): Promise<StagedArchiveUploadResult> {
  const { file, onProgress } = params

  emitProgress(onProgress, {
    phase: 'preparing',
    percent: 2,
    uploadedBytes: 0,
    totalBytes: file.size,
    detail: 'Preparing multipart upload...',
  })

  const initResponse = await fetch('/api/platforms/twitter/upload-archive/multipart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'init',
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    }),
  })

  const initData = await readJsonSafe<MultipartInitResponse>(initResponse)
  if (!initResponse.ok || !initData?.success || !initData.uploadId || !initData.stagedInputPath || !initData.partSize) {
    throw new Error(initData?.error || 'Failed to initialize multipart upload')
  }

  const uploadId = initData.uploadId
  const stagedInputPath = initData.stagedInputPath
  const partSize = initData.partSize
  const totalParts = Math.max(1, initData.totalParts || Math.ceil(file.size / partSize))
  const concurrentWorkers = Math.min(4, totalParts)
  let nextPart = 1
  let uploadedBytesTotal = 0
  const partLoadedBytes = new Array<number>(totalParts).fill(0)
  const completedParts: Array<{ partNumber: number; etag: string }> = []

  emitProgress(onProgress, {
    phase: 'uploading',
    percent: UPLOAD_PROGRESS_MIN,
    uploadedBytes: 0,
    totalBytes: file.size,
    detail: `Uploading in ${totalParts} parts...`,
  })

  const uploadOnePart = async (partNumber: number) => {
    const partIndex = partNumber - 1
    const start = partIndex * partSize
    const end = Math.min(file.size, start + partSize)
    const partBlob = file.slice(start, end)

    const signResponse = await fetch('/api/platforms/twitter/upload-archive/multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sign',
        stagedInputPath,
        uploadId,
        partNumber,
      }),
    })

    const signData = await readJsonSafe<MultipartSignResponse>(signResponse)
    if (!signResponse.ok || !signData?.success || !signData.uploadUrl) {
      throw new Error(signData?.error || `Failed to sign upload part ${partNumber}`)
    }

    const uploadPartResponse = await uploadBlobViaXhr({
      url: signData.uploadUrl,
      body: partBlob,
      onProgress: (loadedBytes) => {
        const previous = partLoadedBytes[partIndex]
        const boundedLoaded = Math.max(previous, Math.min(loadedBytes, partBlob.size))
        const delta = boundedLoaded - previous
        if (delta > 0) {
          partLoadedBytes[partIndex] = boundedLoaded
          uploadedBytesTotal += delta
          emitProgress(onProgress, {
            phase: 'uploading',
            percent: uploadProgressPercent(uploadedBytesTotal, file.size),
            uploadedBytes: uploadedBytesTotal,
            totalBytes: file.size,
            detail: `Uploading parts (${completedParts.length + 1}/${totalParts})...`,
          })
        }
      },
    })

    if (!uploadPartResponse.ok) {
      throw new Error(`Failed to upload part ${partNumber} (status ${uploadPartResponse.status})`)
    }

    const etag = uploadPartResponse.etag?.trim()
    if (!etag) {
      throw new Error(`Missing ETag for uploaded part ${partNumber}`)
    }

    const previous = partLoadedBytes[partIndex]
    if (previous < partBlob.size) {
      const delta = partBlob.size - previous
      partLoadedBytes[partIndex] = partBlob.size
      uploadedBytesTotal += delta
    }

    completedParts.push({
      partNumber,
      etag,
    })
  }

  try {
    const workers = Array.from({ length: concurrentWorkers }, () =>
      (async () => {
        while (true) {
          const partNumber = nextPart
          nextPart += 1
          if (partNumber > totalParts) break
          await uploadOnePart(partNumber)
        }
      })(),
    )

    await Promise.all(workers)
  } catch (error) {
    await fetch('/api/platforms/twitter/upload-archive/multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'abort',
        stagedInputPath,
        uploadId,
      }),
    }).catch(() => null)

    throw error
  }

  emitProgress(onProgress, {
    phase: 'finalizing',
    percent: FINALIZING_PROGRESS,
    uploadedBytes: file.size,
    totalBytes: file.size,
    detail: 'Finalizing multipart upload...',
  })

  const completeResponse = await fetch('/api/platforms/twitter/upload-archive/multipart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'complete',
      stagedInputPath,
      uploadId,
      parts: completedParts,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      startProcessing: false,
    }),
  })

  const completeData = await readJsonSafe<MultipartCompleteResponse>(completeResponse)
  if (!completeResponse.ok || !completeData?.success || !completeData.stagedInputPath) {
    throw new Error(completeData?.error || 'Failed to finalize multipart upload')
  }

  emitProgress(onProgress, {
    phase: 'processing',
    percent: 100,
    uploadedBytes: file.size,
    totalBytes: file.size,
    detail: 'Upload complete. Ready to review archive contents.',
  })

  return {
    success: true,
    stagedInputPath: completeData.stagedInputPath,
    fileName: file.name,
    fileType: file.type,
    fileSize: typeof completeData.fileSize === 'number' && completeData.fileSize > 0 ? completeData.fileSize : file.size,
    message: completeData.message || 'Archive uploaded. Review archive contents before importing.',
  }
}

export async function uploadTwitterArchiveToStaging(params: {
  file: File
  onProgress?: (progress: DirectUploadProgress) => void
}): Promise<StagedArchiveUploadResult> {
  const { file, onProgress } = params

  try {
    if (file.size >= MULTIPART_MIN_BYTES) {
      return await uploadMultipartToStaging({ file, onProgress })
    }

    return await uploadSinglePartToStaging({ file, onProgress })
  } catch (error) {
    return {
      success: false,
      error: readErrorFallback(error, DEFAULT_UPLOAD_ERROR),
    }
  }
}

export async function startTwitterArchiveImport(params: {
  stagedInputPath: string
  fileName: string
  fileType?: string
  fileSize: number
  username?: string
  importSelection?: unknown
  dmEncryption?: DmEncryptionUploadMetadata | null
  preserveArchiveFile?: boolean
}): Promise<DirectUploadResult> {
  const importSelection = normalizeArchiveImportSelection(
    params.importSelection || DEFAULT_ARCHIVE_IMPORT_SELECTION,
  )

  try {
    const completeResponse = await fetch('/api/platforms/twitter/upload-archive/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stagedInputPath: params.stagedInputPath,
        fileName: params.fileName,
        fileType: params.fileType,
        fileSize: params.fileSize,
        username: params.username,
        importSelection,
        dmEncryption: params.dmEncryption || null,
        preserveArchiveFile: params.preserveArchiveFile,
      }),
    })

    const completeData = await readJsonSafe<DirectUploadResult>(completeResponse)
    if (!completeResponse.ok || !completeData?.success) {
      throw new Error(completeData?.error || 'Failed to start archive processing')
    }

    return completeData
  } catch (error) {
    return {
      success: false,
      error: readErrorFallback(error, 'Failed to start archive processing'),
    }
  }
}

export async function discardStagedTwitterArchive(stagedInputPath: string): Promise<void> {
  if (!stagedInputPath) return

  await fetch('/api/platforms/twitter/upload-archive/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedInputPath }),
  }).catch(() => null)
}

export async function uploadEncryptedDmPayloadToStaging(params: {
  payload: EncryptedDirectMessagesPayload
  fileName?: string
}): Promise<{ success: true; stagedInputPath: string } | { success: false; error: string }> {
  const fileName = params.fileName || 'encrypted-dms.json'
  const body = JSON.stringify(params.payload)
  const blob = new Blob([body], { type: 'application/json' })

  try {
    const presignResponse = await fetch('/api/platforms/twitter/upload-archive/dm-encryption/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        fileSize: blob.size,
      }),
    })

    const presignData = await readJsonSafe<DmEncryptionPresignResponse>(presignResponse)
    if (!presignResponse.ok || !presignData?.success || !presignData.uploadUrl || !presignData.stagedInputPath) {
      throw new Error(presignData?.error || 'Failed to create encrypted DM upload URL')
    }

    const uploadResponse = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: blob,
    })

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload encrypted DM payload (status ${uploadResponse.status})`)
    }

    return {
      success: true,
      stagedInputPath: presignData.stagedInputPath,
    }
  } catch (error) {
    return {
      success: false,
      error: readErrorFallback(error, 'Failed to upload encrypted DM payload'),
    }
  }
}

export async function uploadTwitterArchiveDirect(params: {
  file: File
  username?: string
  onProgress?: (progress: DirectUploadProgress) => void
  importSelection?: ArchiveImportSelection
}): Promise<DirectUploadResult> {
  const { file, username, onProgress, importSelection } = params

  const staged = await uploadTwitterArchiveToStaging({ file, onProgress })
  if (!staged.success || !staged.stagedInputPath) {
    return {
      success: false,
      error: staged.error || DEFAULT_UPLOAD_ERROR,
    }
  }

  return startTwitterArchiveImport({
    stagedInputPath: staged.stagedInputPath,
    fileName: staged.fileName || file.name,
    fileType: staged.fileType || file.type,
    fileSize: staged.fileSize || file.size,
    username,
    importSelection: importSelection || DEFAULT_ARCHIVE_IMPORT_SELECTION,
  })
}
