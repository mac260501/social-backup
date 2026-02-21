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

type PresignResponse = {
  success: boolean
  uploadUrl?: string
  stagedInputPath?: string
  error?: string
}

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

export async function uploadTwitterArchiveDirect(params: {
  file: File
  username?: string
}): Promise<DirectUploadResult> {
  const { file, username } = params

  try {
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

    const putResponse = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      body: file,
    })

    if (!putResponse.ok) {
      throw new Error(`Failed to upload file to storage (status ${putResponse.status}).`)
    }

    const completeResponse = await fetch('/api/platforms/twitter/upload-archive/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stagedInputPath: presignData.stagedInputPath,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        username,
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
      error: readErrorFallback(
        error,
        'Failed to upload archive. Confirm R2 CORS allows PUT from your app domain and retry.',
      ),
    }
  }
}
