import { NextResponse } from 'next/server'
import { setShareCookie, verifyShareToken } from '@/lib/share-links'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params
  const grant = verifyShareToken(token)
  const origin = new URL(request.url).origin

  if (!grant) {
    return NextResponse.redirect(new URL('/?share=invalid', origin))
  }

  const redirectUrl = new URL(`/dashboard/backup/${grant.backupId}`, origin)
  redirectUrl.searchParams.set('shared', '1')
  const response = NextResponse.redirect(redirectUrl)
  setShareCookie(response, token, grant.expiresAtEpochSeconds)
  return response
}
