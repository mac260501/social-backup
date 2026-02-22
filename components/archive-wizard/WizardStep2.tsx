type WizardStep2Props = {
  updating: boolean
  message: string | null
  error: string | null
  onDownloaded: () => void
  onNotReady: () => void
  onBack: () => void
}

export function WizardStep2({ updating, message, error, onDownloaded, onNotReady, onBack }: WizardStep2Props) {
  return (
    <section className="rounded-3xl border border-white/15 bg-[#0f1937]/92 p-6 shadow-[0_14px_40px_rgba(4,10,28,0.35)] sm:p-8">
      <h2 className="text-3xl font-bold text-white">Download Your Archive</h2>
      <p className="mt-3 text-blue-100/85">
        Twitter usually prepares archives within 24-72 hours. Check your Twitter notifications or email, then download the ZIP file.
      </p>

      <ol className="mt-5 list-decimal space-y-2 pl-5 text-blue-100/90">
        <li>Open the Twitter archive page.</li>
        <li>Click the <span className="font-semibold text-white">Download</span> button.</li>
        <li>Save the ZIP file where you can find it.</li>
        <li>Return here and continue to upload.</li>
      </ol>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onBack}
          disabled={updating}
          className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/5 px-6 py-3 text-sm font-semibold text-blue-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Back to step 1
        </button>
        <a
          href="https://x.com/settings/download_your_data"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1]"
        >
          Open Twitter Download Page
        </a>
        <button
          type="button"
          onClick={onDownloaded}
          disabled={updating}
          className="inline-flex items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-500/25 px-6 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/35 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {updating ? 'Saving...' : "I've Downloaded It"}
        </button>
        <button
          type="button"
          onClick={onNotReady}
          disabled={updating}
          className="inline-flex items-center justify-center rounded-full border border-amber-400/60 bg-amber-500/20 px-6 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          It&apos;s not ready yet
        </button>
      </div>

      {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
    </section>
  )
}
