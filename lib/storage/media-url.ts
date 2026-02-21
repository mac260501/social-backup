function normalizeStoragePath(path: string): string {
  return path.trim().replace(/^\/+/, '')
}

export function buildInternalMediaUrl(storagePath: string): string {
  const key = normalizeStoragePath(storagePath)
  return `/api/platforms/twitter/media?path=${encodeURIComponent(key)}`
}
