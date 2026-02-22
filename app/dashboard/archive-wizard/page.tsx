'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ThemeLoadingScreen } from '@/components/theme-loading-screen'
import { createClient } from '@/lib/supabase/client'
import { ProgressBar } from '@/components/archive-wizard/ProgressBar'
import { WizardStep1 } from '@/components/archive-wizard/WizardStep1'
import { WizardStep2 } from '@/components/archive-wizard/WizardStep2'
import { WizardStep3 } from '@/components/archive-wizard/WizardStep3'
import { WizardSuccess } from '@/components/archive-wizard/WizardSuccess'
import {
  type DirectUploadProgress,
  uploadTwitterArchiveDirect,
} from '@/lib/platforms/twitter/direct-upload'
import type {
  ArchiveWizardJobSummary,
  ArchiveWizardResolvedStep,
  ArchiveWizardStatusResponse,
} from '@/lib/archive-wizard/types'

type BackupRecord = {
  id: string
  data?: {
    stats?: {
      tweets?: number
      followers?: number
      following?: number
      likes?: number
      dms?: number
      media_files?: number
    }
  } | null
}

type BackupsResponse = {
  success?: boolean
  backups?: BackupRecord[]
  jobs?: Array<
    ArchiveWizardJobSummary & {
      error_message?: string | null
      payload?: Record<string, unknown> | null
    }
  >
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function toSuccessStats(backup: BackupRecord | null) {
  if (!backup?.data?.stats) return null
  const stats = backup.data.stats
  return {
    tweets: parseNumber(stats.tweets),
    followers: parseNumber(stats.followers),
    following: parseNumber(stats.following),
    likes: parseNumber(stats.likes),
    dms: parseNumber(stats.dms),
    mediaFiles: parseNumber(stats.media_files),
  }
}

function parseStepParam(value: string | null): ArchiveWizardResolvedStep | null {
  if (value === 'success') return 'success'
  if (value === '1' || value === '2' || value === '3') return Number(value) as 1 | 2 | 3
  return null
}

export default function ArchiveWizardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(true)

  const [wizardStatus, setWizardStatus] = useState<ArchiveWizardStatusResponse | null>(null)
  const [currentStep, setCurrentStep] = useState<ArchiveWizardResolvedStep>(1)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0)
  const [uploadProgressDetail, setUploadProgressDetail] = useState<string | null>(null)
  const [updatingStepState, setUpdatingStepState] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stepMessage, setStepMessage] = useState<string | null>(null)

  const [activeJob, setActiveJob] = useState<ArchiveWizardJobSummary | null>(null)
  const [successBackupId, setSuccessBackupId] = useState<string | null>(null)
  const [successStats, setSuccessStats] = useState<{
    tweets: number
    followers: number
    following: number
    likes: number
    dms: number
    mediaFiles: number
  } | null>(null)

  const completionHandledRef = useRef<string | null>(null)

  const setUrlStep = (nextStep: ArchiveWizardResolvedStep) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('step', String(nextStep))
    router.replace(`/dashboard/archive-wizard?${params.toString()}`)
    setCurrentStep(nextStep)
  }

  const loadWizardStatus = async () => {
    setStatusLoading(true)
    try {
      const response = await fetch('/api/archive-wizard/status', { cache: 'no-store' })
      const result = (await response.json()) as ArchiveWizardStatusResponse

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load wizard status')
      }

      setWizardStatus(result)
      if (result.activeArchiveJob) {
        setActiveJob(result.activeArchiveJob)
      }

      if (result.latestArchiveBackupId) {
        setSuccessBackupId(result.latestArchiveBackupId)
      }

      if (result.latestArchiveBackupStats) {
        setSuccessStats(result.latestArchiveBackupStats)
      }

      const requestedStep = parseStepParam(searchParams.get('step'))
      if (requestedStep) {
        setCurrentStep(requestedStep)
      } else {
        setCurrentStep(result.suggestedStep)
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load wizard status')
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      if (!currentUser) {
        router.replace('/login')
        return
      }

      setUser(currentUser)
      setAuthLoading(false)
      await loadWizardStatus()
    }

    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase])

  useEffect(() => {
    const stepFromUrl = parseStepParam(searchParams.get('step'))
    if (stepFromUrl && stepFromUrl !== currentStep) {
      setCurrentStep(stepFromUrl)
    }
  }, [currentStep, searchParams])

  useEffect(() => {
    if (!activeJob) return

    completionHandledRef.current = null

    if (activeJob.status !== 'queued' && activeJob.status !== 'processing') {
      return
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/backups', { cache: 'no-store' })
        const data = (await response.json()) as BackupsResponse
        if (!response.ok || !data.success) return

        const matchedJob = data.jobs?.find((job) => job.id === activeJob.id)
        if (!matchedJob) return

        setActiveJob({
          id: matchedJob.id,
          status: matchedJob.status,
          progress: parseNumber(matchedJob.progress),
          message: matchedJob.message || null,
          result_backup_id: matchedJob.result_backup_id,
        })

        if (matchedJob.status === 'failed') {
          setError(matchedJob.error_message || matchedJob.message || 'Archive processing failed.')
          return
        }

        if (matchedJob.status === 'completed' && completionHandledRef.current !== matchedJob.id) {
          completionHandledRef.current = matchedJob.id
          const backupId = matchedJob.result_backup_id || null
          const backup = backupId ? data.backups?.find((item) => item.id === backupId) || null : null

          setSuccessBackupId(backupId)
          setSuccessStats(toSuccessStats(backup))

          await fetch('/api/archive-wizard/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          })

          setUploadMessage('Archive backup completed successfully.')
          setUrlStep('success')
        }
      } catch (pollError) {
        console.error('Failed to poll archive job:', pollError)
      }
    }, 1500)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id, activeJob?.status])

  const handleRequested = async () => {
    setError(null)
    setStepMessage(null)
    setUpdatingStepState(true)

    try {
      const response = await fetch('/api/archive-wizard/request', { method: 'POST' })
      const result = (await response.json()) as { success?: boolean; error?: string; message?: string }

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save request step')
      }

      setStepMessage(result.message || 'Request recorded.')
      router.push('/dashboard?archiveRequested=1')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save request step')
    } finally {
      setUpdatingStepState(false)
    }
  }

  const updateStatus = async (status: string, nextStep?: ArchiveWizardResolvedStep, message?: string) => {
    setError(null)
    setStepMessage(null)
    setUpdatingStepState(true)

    try {
      const response = await fetch('/api/archive-wizard/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      const result = (await response.json()) as ArchiveWizardStatusResponse

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update wizard status')
      }

      setWizardStatus(result)
      if (message) setStepMessage(message)
      if (nextStep) setUrlStep(nextStep)
    } finally {
      setUpdatingStepState(false)
    }
  }

  const handleSkip = async () => {
    try {
      await updateStatus('skipped')
      router.push('/dashboard')
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to skip wizard')
    }
  }

  const handleAlreadyHaveArchive = async () => {
    try {
      await updateStatus('ready', 3)
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to jump to upload step')
    }
  }

  const handleDownloaded = async () => {
    try {
      await updateStatus('ready', 3)
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to save step')
    }
  }

  const handleNotReady = async () => {
    try {
      setError(null)
      setStepMessage(null)
      setUpdatingStepState(true)

      const response = await fetch('/api/archive-wizard/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending_extended', resetRequestedAt: true, resetReminders: true }),
      })
      const result = (await response.json()) as ArchiveWizardStatusResponse
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to reset reminders')
      }

      setWizardStatus(result)
      setStepMessage('No worries. We reset your reminder timer and will check in again soon.')
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to reset reminder timing')
    } finally {
      setUpdatingStepState(false)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Select your Twitter archive ZIP file first.')
      return
    }

    const lowerName = selectedFile.name.toLowerCase()
    if (!lowerName.endsWith('.zip')) {
      setError('This does not look like a ZIP file. Upload the archive ZIP downloaded from Twitter.')
      return
    }

    setUploading(true)
    setUploadProgressPercent(0)
    setUploadProgressDetail('Preparing upload...')
    setError(null)
    setUploadMessage(null)

    const usernameFromMetadata =
      (user?.user_metadata?.user_name as string | undefined) ||
      (user?.user_metadata?.preferred_username as string | undefined)

    try {
      const result = (await uploadTwitterArchiveDirect({
        file: selectedFile,
        username: usernameFromMetadata,
        onProgress: (progress: DirectUploadProgress) => {
          setUploadProgressPercent(progress.percent)
          setUploadProgressDetail(progress.detail || null)
        },
      })) as {
        success?: boolean
        error?: string
        message?: string
        job?: ArchiveWizardJobSummary
      }

      if (!result.success || !result.job) {
        throw new Error(result.error || 'Failed to upload archive')
      }

      setUploadMessage(result.message || 'Archive uploaded. Processing started.')
      setActiveJob(result.job)
      setUrlStep(3)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload archive')
    } finally {
      setUploading(false)
      setUploadProgressPercent(0)
      setUploadProgressDetail(null)
    }
  }

  if (authLoading || statusLoading) {
    return <ThemeLoadingScreen label="Loading archive wizard..." />
  }

  if (!user) return null

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#22325f_0%,#121a34_35%,#0a1024_65%,#050813_100%)] text-white">
      <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200/70">Social Backup</p>
            <h1 className="text-3xl font-bold">Twitter Archive Setup Wizard</h1>
          </div>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:bg-white/10"
          >
            Back to Dashboard
          </button>
        </div>

        {wizardStatus?.schemaReady === false && (
          <section className="mb-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            Archive wizard database columns are missing. Run migration
            {' '}
            <code>supabase/migrations/008_add_archive_wizard_profile_fields.sql</code>
            {' '}
            in your Supabase SQL editor, then refresh.
          </section>
        )}

        <ProgressBar currentStep={currentStep === 'success' ? 3 : currentStep} completed={currentStep === 'success'} />

        <div className="mt-6 space-y-5">
          {currentStep === 1 && (
            <WizardStep1
              requesting={updatingStepState}
              message={stepMessage}
              error={error}
              onRequested={() => {
                void handleRequested()
              }}
              onSkip={() => {
                void handleSkip()
              }}
              onAlreadyHaveArchive={() => {
                void handleAlreadyHaveArchive()
              }}
            />
          )}

          {currentStep === 2 && (
            <WizardStep2
              updating={updatingStepState}
              message={stepMessage}
              error={error}
              onDownloaded={() => {
                void handleDownloaded()
              }}
              onNotReady={() => {
                void handleNotReady()
              }}
            />
          )}

          {currentStep === 3 && (
            <WizardStep3
              selectedFile={selectedFile}
              uploading={uploading}
              uploadProgressPercent={uploadProgressPercent}
              uploadProgressDetail={uploadProgressDetail}
              activeJob={activeJob}
              uploadMessage={uploadMessage}
              error={error}
              onFileSelected={(file) => {
                setSelectedFile(file)
                if (file) {
                  setError(null)
                  setUploadMessage(null)
                }
              }}
              onUpload={() => {
                void handleUpload()
              }}
            />
          )}

          {currentStep === 'success' && <WizardSuccess stats={successStats} backupId={successBackupId} />}
        </div>
      </div>
    </main>
  )
}
