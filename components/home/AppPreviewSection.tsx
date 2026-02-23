import Image from 'next/image'

export function AppPreviewSection() {
  return (
    <section className="rounded-3xl border border-gray-200/80 bg-white/80 p-6 shadow-[0_18px_55px_rgba(17,24,39,0.08)] backdrop-blur sm:p-8 dark:border-white/12 dark:bg-[#071125]/70 dark:shadow-[0_18px_55px_rgba(2,8,25,0.45)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-cyan-200/90">
        App Preview
      </p>
      <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl dark:text-white">
        Real screenshots from the app.
      </h3>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-700 sm:text-base dark:text-gray-200">
        See the upload flow, snapshot flow, and backup viewer screens before creating an account.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <figure className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/12 dark:bg-white/5">
          <Image
            src="/upload-archive-preview.png"
            alt="Upload archive screen preview"
            width={996}
            height={1588}
            className="h-auto w-full rounded-xl border border-gray-200 dark:border-white/15"
          />
        </figure>

        <figure className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/12 dark:bg-white/5">
          <Image
            src="/take-snapshot-preview-v2.png"
            alt="Take snapshot screen preview"
            width={994}
            height={1152}
            className="h-auto w-full rounded-xl border border-gray-200 dark:border-white/15"
          />
        </figure>
      </div>

      <div className="mt-7 rounded-2xl border border-gray-200 bg-white/90 p-4 dark:border-white/12 dark:bg-white/5">
        <h4 className="text-base font-semibold text-gray-900 dark:text-white">Backup Viewer Screens</h4>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Preview posts, media, and followers views inside a backup.
        </p>

        <div className="mt-4 grid gap-4 md:hidden">
          <figure className="rounded-xl border border-gray-200 bg-white p-2 dark:border-white/12 dark:bg-white/5">
            <Image
              src="/twitter-viewer-mobile-1.jpeg"
              alt="Twitter backup viewer mobile preview screen 1"
              width={1206}
              height={2195}
              className="h-auto w-full rounded-lg border border-gray-200 dark:border-white/15"
            />
          </figure>
          <figure className="rounded-xl border border-gray-200 bg-white p-2 dark:border-white/12 dark:bg-white/5">
            <Image
              src="/twitter-viewer-mobile-2.jpeg"
              alt="Twitter backup viewer mobile preview screen 2"
              width={1206}
              height={1637}
              className="h-auto w-full rounded-lg border border-gray-200 dark:border-white/15"
            />
          </figure>
          <figure className="rounded-xl border border-gray-200 bg-white p-2 dark:border-white/12 dark:bg-white/5">
            <Image
              src="/follower-preview.jpeg"
              alt="Twitter backup viewer followers preview"
              width={1206}
              height={1969}
              className="h-auto w-full rounded-lg border border-gray-200 dark:border-white/15"
            />
          </figure>
        </div>

        <div className="mt-4 hidden gap-4 md:grid md:grid-cols-2">
          <div className="grid gap-4">
            <figure className="rounded-xl border border-gray-200 bg-white p-2 dark:border-white/12 dark:bg-white/5">
              <Image
                src="/twitter-preview-desktop-1.png"
                alt="Twitter backup viewer desktop preview screen 1"
                width={2482}
                height={1042}
                className="h-auto w-full rounded-lg border border-gray-200 dark:border-white/15"
              />
            </figure>

            <figure className="rounded-xl border border-gray-200 bg-white p-2 dark:border-white/12 dark:bg-white/5">
              <Image
                src="/twitter-preview-desktop-2.png"
                alt="Twitter backup viewer desktop preview screen 2"
                width={1258}
                height={1108}
                className="h-auto w-full rounded-lg border border-gray-200 dark:border-white/15"
              />
            </figure>
          </div>

          <figure className="rounded-xl border border-gray-200 bg-white p-2 dark:border-white/12 dark:bg-white/5">
            <div className="relative h-full min-h-[420px] overflow-hidden rounded-lg border border-gray-200 dark:border-white/15">
              <Image
                src="/follower-preview.jpeg"
                alt="Twitter backup viewer followers preview"
                fill
                sizes="(min-width: 768px) 45vw, 100vw"
                className="object-cover object-top"
              />
            </div>
          </figure>
        </div>
      </div>
    </section>
  )
}
