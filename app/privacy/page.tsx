import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | Social Backup',
  description: 'Social Backup privacy policy',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 text-gray-900 dark:bg-black dark:text-white">
      <section className="mx-auto w-full max-w-3xl space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">Effective date: February 21, 2026</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This is an MVP privacy policy for Social Backup and should be reviewed with legal counsel before broad public launch.
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">What we collect</h2>
          <p className="text-gray-700 dark:text-gray-200">
            We collect account details (such as email), profile metadata, and backup content you explicitly upload or request us to
            process.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">How we use data</h2>
          <p className="text-gray-700 dark:text-gray-200">
            We use your data to authenticate your account, run backup jobs, store your archived content, and show your results in the
            app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Storage and processors</h2>
          <p className="text-gray-700 dark:text-gray-200">
            Data is stored and processed through third-party infrastructure providers including Supabase, Cloudflare R2, Vercel,
            Inngest, and Resend.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Data retention and deletion</h2>
          <p className="text-gray-700 dark:text-gray-200">
            You can request account deletion and we will remove associated app data, subject to backup, security, and legal retention
            constraints.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-gray-700 dark:text-gray-200">
            For privacy questions, contact <a className="underline" href="mailto:support@socialbackup.app">support@socialbackup.app</a>.
          </p>
        </section>

        <p className="pt-4 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/" className="underline">
            Back to home
          </Link>
        </p>
      </section>
    </main>
  )
}
