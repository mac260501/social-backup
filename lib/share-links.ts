import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import crypto from 'node:crypto'

export const SHARE_COOKIE_NAME = 'sb_backup_share'
const DEFAULT_SHARE_TTL_SECONDS = 30 * 24 * 60 * 60

type ShareTokenPayload = {
  b: string
  e: number
}

type ShareGrant = {
  backupId: string
  expiresAtEpochSeconds: number
  token: string
}

function readShareSecret() {
  return (
    process.env.BACKUP_SHARE_SECRET?.trim()
    || process.env.NEXTAUTH_SECRET?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || ''
  )
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signPayload(payloadEncoded: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payloadEncoded).digest('base64url')
}

export function createShareToken(
  backupId: string,
  ttlSeconds: number = DEFAULT_SHARE_TTL_SECONDS,
): { token: string; expiresAtEpochSeconds: number } {
  const secret = readShareSecret()
  if (!secret) {
    throw new Error('Missing BACKUP_SHARE_SECRET (or NEXTAUTH_SECRET) for share-link generation.')
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds))
  const payload: ShareTokenPayload = {
    b: backupId,
    e: expiresAtEpochSeconds,
  }

  const payloadEncoded = encodeBase64Url(JSON.stringify(payload))
  const signature = signPayload(payloadEncoded, secret)
  return {
    token: `${payloadEncoded}.${signature}`,
    expiresAtEpochSeconds,
  }
}

export function verifyShareToken(token: string): ShareGrant | null {
  const secret = readShareSecret()
  if (!secret) return null

  const [payloadEncoded, signature] = token.split('.')
  if (!payloadEncoded || !signature) return null

  const expected = signPayload(payloadEncoded, secret)
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null
  }

  try {
    const decoded = decodeBase64Url(payloadEncoded)
    const payload = JSON.parse(decoded) as ShareTokenPayload
    if (!payload || typeof payload.b !== 'string' || typeof payload.e !== 'number') return null
    if (!payload.b.trim()) return null
    if (!Number.isFinite(payload.e)) return null
    if (payload.e < Math.floor(Date.now() / 1000)) return null
    return {
      backupId: payload.b,
      expiresAtEpochSeconds: payload.e,
      token,
    }
  } catch {
    return null
  }
}

export function setShareCookie(response: NextResponse, token: string, expiresAtEpochSeconds: number) {
  const ttlSeconds = Math.max(1, expiresAtEpochSeconds - Math.floor(Date.now() / 1000))
  response.cookies.set(SHARE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttlSeconds,
  })
}

export async function getShareGrantFromCookies(): Promise<ShareGrant | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SHARE_COOKIE_NAME)?.value
  if (!token) return null
  return verifyShareToken(token)
}
