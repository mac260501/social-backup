import { redirect } from 'next/navigation'

export default function BackupsPageRedirect() {
  redirect('/dashboard?tab=all-backups')
}
