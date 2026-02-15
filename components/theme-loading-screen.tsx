export function ThemeLoadingScreen({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-gray-900 dark:bg-black dark:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.18),transparent_52%)] dark:bg-[radial-gradient(circle_at_center,rgba(29,155,240,0.14),transparent_58%)]" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1d9bf0]/25 border-t-[#1d9bf0]" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</p>
      </div>
    </div>
  )
}
