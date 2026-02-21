import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service | Social Backup',
  description: 'Social Backup terms of service',
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 text-gray-900 dark:bg-black dark:text-white">
      <section className="mx-auto w-full max-w-3xl space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold">Terms of Service</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">Effective date: February 21, 2026</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            These MVP terms should be reviewed with legal counsel before full public launch.
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Use of the service</h2>
          <p className="text-gray-700 dark:text-gray-200">
            Social Backup lets you archive and view social platform data you are authorized to access. You are responsible for your
            account activity and compliance with applicable laws and platform terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Account and security</h2>
          <p className="text-gray-700 dark:text-gray-200">
            Keep your credentials secure. We may suspend access for abuse, fraud, security threats, or violations of these terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">No warranty</h2>
          <p className="text-gray-700 dark:text-gray-200">
            The service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, to the maximum
            extent allowed by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Limitation of liability</h2>
          <p className="text-gray-700 dark:text-gray-200">
            To the maximum extent allowed by law, Social Backup is not liable for indirect, incidental, special, consequential, or
            punitive damages.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-gray-700 dark:text-gray-200">
            Questions about these terms: <a className="underline" href="mailto:support@socialbackup.app">support@socialbackup.app</a>.
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
