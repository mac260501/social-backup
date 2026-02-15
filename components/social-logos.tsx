export function XLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <path
        d="M18.9 3H22l-6.77 7.73L23 21h-6.1l-4.78-6.24L6.65 21H3.53l7.23-8.27L3.3 3h6.24l4.31 5.68L18.9 3z"
        className="fill-black dark:fill-white"
      />
    </svg>
  )
}

export function InstagramLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0%" stopColor="#feda75" />
          <stop offset="35%" stopColor="#fa7e1e" />
          <stop offset="65%" stopColor="#d62976" />
          <stop offset="100%" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#ig-grad)" />
      <circle cx="12" cy="12" r="4" className="fill-none stroke-white" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.7" r="1.2" className="fill-white" />
    </svg>
  )
}

export function TikTokLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <path d="M14.8 5.2v8.6a3.8 3.8 0 1 1-2.9-3.7v2.2a1.6 1.6 0 1 0 .8 1.4V3h2.1c.3 1.5 1.4 2.8 2.9 3.4v2.2a6.1 6.1 0 0 1-2.9-1.4z" fill="#25F4EE" />
      <path d="M13.9 5v8.5a3.8 3.8 0 1 1-2.9-3.6v2.1a1.6 1.6 0 1 0 .8 1.4V2.8h2.1c.3 1.5 1.4 2.8 2.9 3.4v2.1A6.1 6.1 0 0 1 13.9 7z" fill="#FE2C55" opacity="0.85" />
      <path d="M14.35 4.1v8.5a3.8 3.8 0 1 1-2.9-3.65v2.15a1.6 1.6 0 1 0 .8 1.4V2h2.1c.3 1.5 1.4 2.8 2.9 3.4v2.15a6.1 6.1 0 0 1-2.9-1.45z" className="fill-black dark:fill-white" />
    </svg>
  )
}

export function SocialLogoRow() {
  return (
    <div className="mb-8 flex items-center gap-4 rounded-full border border-gray-200/70 bg-white/70 px-5 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
      <XLogo />
      <InstagramLogo />
      <TikTokLogo />
    </div>
  )
}
