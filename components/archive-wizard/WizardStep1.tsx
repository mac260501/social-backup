type WizardStep1Props = {
  requesting: boolean
  message: string | null
  error: string | null
  onRequested: () => void
  onSkip: () => void
  onAlreadyHaveArchive: () => void
}

export function WizardStep1({
  requesting,
  message,
  error,
  onRequested,
  onSkip,
  onAlreadyHaveArchive,
}: WizardStep1Props) {
  return (
    <section className="rounded-3xl border border-white/15 bg-[#0f1937]/92 p-6 shadow-[0_14px_40px_rgba(4,10,28,0.35)] sm:p-8">
      <h2 className="text-3xl font-bold text-white">Request Your Twitter Archive</h2>
      <p className="mt-3 text-blue-100/85">
        Twitter keeps a copy of your tweets, likes, followers, and messages. Request your archive, then come back here to upload it.
      </p>

      <ol className="mt-5 list-decimal space-y-2 pl-5 text-blue-100/90">
        <li>Open Twitter settings.</li>
        <li>Confirm your password if prompted.</li>
        <li>Click <span className="font-semibold text-white">Request archive</span>.</li>
        <li>Return and click <span className="font-semibold text-white">I&apos;ve Requested My Archive</span>.</li>
      </ol>

      <div className="mt-6 rounded-2xl border border-white/10 bg-[#0a1430] p-4 text-sm text-blue-100/80">
        Need help? Use the same Twitter page below and look for the archive request button.
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href="https://x.com/settings/download_your_data"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1]"
        >
          Open Twitter Settings
        </a>
        <button
          type="button"
          onClick={onRequested}
          disabled={requesting}
          className="inline-flex items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-500/25 px-6 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/35 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {requesting ? 'Saving...' : "I've Requested My Archive"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <button type="button" onClick={onAlreadyHaveArchive} className="text-blue-200 underline-offset-4 hover:underline">
          I already have an archive
        </button>
        <button type="button" onClick={onSkip} className="text-blue-200/80 underline-offset-4 hover:text-blue-100 hover:underline">
          Skip for now
        </button>
      </div>

      {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
    </section>
  )
}
