import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function isSafeRelativePath(path: string | null) {
  return Boolean(path && path.startsWith('/') && !path.startsWith('//'))
}

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach(({ name, value, ...options }) => {
    to.cookies.set(name, value, options)
  })
  return to
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })
  const pathname = request.nextUrl.pathname
  const isPublicPath =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/privacy' ||
    pathname === '/terms'

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const code = request.nextUrl.searchParams.get('code')
  if (code && !pathname.startsWith('/api')) {
    const requestedNext = request.nextUrl.searchParams.get('next')
    const nextPath = isSafeRelativePath(requestedNext) ? requestedNext : '/dashboard'
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    const redirectUrl = error
      ? new URL('/login?error=auth_failed', request.url)
      : new URL(nextPath, request.url)
    const redirectResponse = NextResponse.redirect(redirectUrl)
    return copyCookies(supabaseResponse, redirectResponse)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (
    !user &&
    !isPublicPath &&
    !pathname.startsWith('/auth') &&
    !pathname.startsWith('/api')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
