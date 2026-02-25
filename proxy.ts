import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function isSafeRelativePath(path: string | null): path is string {
  return Boolean(path && path.startsWith('/') && !path.startsWith('//'))
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const pathname = request.nextUrl.pathname
  const isPublicPath =
    pathname === '/' ||
    pathname.startsWith('/shared/') ||
    pathname.startsWith('/dashboard/backup/') ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/privacy' ||
    pathname === '/terms'

  const code = request.nextUrl.searchParams.get('code')
  if (code && !pathname.startsWith('/api') && pathname !== '/login') {
    const requestedNext = request.nextUrl.searchParams.get('next')
    const nextPath = isSafeRelativePath(requestedNext) ? requestedNext : '/dashboard'
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('code', code)
    loginUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(loginUrl)
  }

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
