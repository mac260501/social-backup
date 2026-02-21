import { NextResponse } from 'next/server'

function isSafeRelativePath(path: string | null): path is string {
  return Boolean(path && path.startsWith('/') && !path.startsWith('//'))
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const requestedNext = searchParams.get('next')
  const next = isSafeRelativePath(requestedNext) ? requestedNext : '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const loginRedirectUrl = new URL('/login', origin)
  loginRedirectUrl.searchParams.set('code', code)
  loginRedirectUrl.searchParams.set('next', next)
  return NextResponse.redirect(loginRedirectUrl)
}
