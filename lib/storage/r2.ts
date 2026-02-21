import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600

type UploadObjectInput = {
  key: string
  body: Buffer | Uint8Array | string
  contentType?: string
  upsert?: boolean
}

export type R2ObjectMetadata = {
  contentLength: number | null
  contentType: string | null
}

function readEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  const endpointFromEnv = process.env.R2_ENDPOINT?.trim()

  return {
    accountId,
    bucket: readEnv('R2_BUCKET'),
    region: process.env.R2_REGION?.trim() || 'auto',
    endpoint: endpointFromEnv || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null),
    accessKeyId: readEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: readEnv('R2_SECRET_ACCESS_KEY'),
  }
}

let r2Client: S3Client | null = null

export function getR2Client(): S3Client {
  if (r2Client) return r2Client

  const config = getR2Config()
  if (!config.endpoint) {
    throw new Error('Missing required environment variable: R2_ENDPOINT (or set R2_ACCOUNT_ID)')
  }

  r2Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return r2Client
}

export function normalizeStoragePath(path: string): string {
  return path.trim().replace(/^\/+/, '')
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const details = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  return (
    details.name === 'NotFound' ||
    details.Code === 'NotFound' ||
    details.$metadata?.httpStatusCode === 404
  )
}

export async function objectExists(key: string): Promise<boolean> {
  const metadata = await getObjectMetadataFromR2(key)
  return Boolean(metadata)
}

export async function getObjectMetadataFromR2(key: string): Promise<R2ObjectMetadata | null> {
  const client = getR2Client()
  const { bucket } = getR2Config()
  const normalizedKey = normalizeStoragePath(key)

  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
      }),
    )
    return {
      contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
      contentType: typeof response.ContentType === 'string' ? response.ContentType : null,
    }
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

export async function uploadObjectToR2(input: UploadObjectInput): Promise<{ alreadyExists: boolean }> {
  const client = getR2Client()
  const { bucket } = getR2Config()
  const key = normalizeStoragePath(input.key)
  const upsert = input.upsert !== false

  if (!upsert) {
    const exists = await objectExists(key)
    if (exists) {
      return { alreadyExists: true }
    }
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  )

  return { alreadyExists: false }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0)

  const asBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>
  }

  if (typeof asBody.transformToByteArray === 'function') {
    const bytes = await asBody.transformToByteArray()
    return Buffer.from(bytes)
  }

  if (typeof asBody.getReader === 'function') {
    const reader = asBody.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  }

  if (typeof asBody[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = []
    for await (const chunk of asBody as AsyncIterable<Uint8Array | Buffer | string>) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  throw new Error('Unsupported object body type from R2 getObject')
}

export async function downloadObjectFromR2(key: string): Promise<Buffer | null> {
  const client = getR2Client()
  const { bucket } = getR2Config()
  const normalizedKey = normalizeStoragePath(key)

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
      }),
    )

    if (!response.Body) return null
    return bodyToBuffer(response.Body)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

export async function deleteObjectsFromR2(keys: string[]): Promise<void> {
  if (keys.length === 0) return

  const client = getR2Client()
  const { bucket } = getR2Config()
  const uniqueKeys = Array.from(new Set(keys.map((key) => normalizeStoragePath(key)).filter(Boolean)))

  const batchSize = 1000
  for (let i = 0; i < uniqueKeys.length; i += batchSize) {
    const chunk = uniqueKeys.slice(i, i + batchSize)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    )
  }
}

export async function listObjectPaths(prefix: string, limit = 100): Promise<string[]> {
  const client = getR2Client()
  const { bucket } = getR2Config()
  const normalizedPrefix = normalizeStoragePath(prefix)

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizedPrefix,
      MaxKeys: limit,
    }),
  )

  return (response.Contents || [])
    .map((entry) => entry.Key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
}

export async function createSignedGetUrl(
  key: string,
  options?: {
    expiresInSeconds?: number
    downloadFileName?: string
  },
): Promise<string> {
  const client = getR2Client()
  const { bucket } = getR2Config()
  const normalizedKey = normalizeStoragePath(key)

  const expiresInSeconds = Math.max(1, options?.expiresInSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS)
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: normalizedKey,
    ResponseContentDisposition: options?.downloadFileName
      ? `attachment; filename="${options.downloadFileName.replace(/\"/g, '')}"`
      : undefined,
  })

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
}

export async function createSignedPutUrl(
  key: string,
  options?: {
    expiresInSeconds?: number
    contentType?: string
  },
): Promise<string> {
  const client = getR2Client()
  const { bucket } = getR2Config()
  const normalizedKey = normalizeStoragePath(key)

  const expiresInSeconds = Math.max(1, options?.expiresInSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS)
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: normalizedKey,
    ContentType: options?.contentType,
  })

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
}

export function parseLegacyStoragePath(candidate: string): string | null {
  const value = candidate.trim()
  if (!value) return null

  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('/api/')
  ) {
    const knownMarkers = [
      '/storage/v1/object/public/twitter-media/',
      '/storage/v1/object/sign/twitter-media/',
      '/storage/v1/object/twitter-media/',
      '/twitter-media/',
      '/social-backup/',
    ]
    const urlWithoutQuery = value.split('?')[0]
    for (const marker of knownMarkers) {
      if (urlWithoutQuery.includes(marker)) {
        const parsed = urlWithoutQuery.split(marker)[1]
        if (parsed) return normalizeStoragePath(parsed)
      }
    }
    return null
  }

  return normalizeStoragePath(value)
}
