'use client'

import { useRef, type ChangeEvent, type DragEvent } from 'react'
import type { ArchiveWizardJobSummary } from '@/lib/archive-wizard/types'

type WizardStep3Props = {
  selectedFile: File | null
  uploading: boolean
  uploadProgressPercent: number
  uploadProgressDetail: string | null
  activeJob: ArchiveWizardJobSummary | null
  uploadMessage: string | null
  error: string | null
  onFileSelected: (file: File | null) => void
  onUpload: () => void
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0

  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }

  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export function WizardStep3({
  selectedFile,
  uploading,
  uploadProgressPercent,
  uploadProgressDetail,
  activeJob,
  uploadMessage,
  error,
  onFileSelected,
  onUpload,
}: WizardStep3Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileSelected(event.target.files?.[0] ?? null)
  }

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const dropped = event.dataTransfer.files?.[0]
    if (!dropped) return
    onFileSelected(dropped)
  }

  const processing = activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing')

  return (
    <section className="rounded-3xl border border-white/15 bg-[#0f1937]/92 p-6 shadow-[0_14px_40px_rgba(4,10,28,0.35)] sm:p-8">
      <h2 className="text-3xl font-bold text-white">Upload Your Archive</h2>
      <p className="mt-3 text-blue-100/85">
        Drag and drop your Twitter archive ZIP, or browse to select it. Once uploaded, backup processing runs in the background.
      </p>

      <button
        type="button"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className="mt-6 w-full rounded-2xl border border-dashed border-white/30 bg-[#0a1430] p-10 text-center transition hover:border-blue-300/70 hover:bg-[#0c1a40]"
      >
        <p className="text-lg font-semibold text-white">Drag & drop your ZIP file here</p>
        <p className="mt-2 text-sm text-blue-100/80">or click to browse</p>
        <p className="mt-2 text-xs text-blue-100/60">Example: twitter-2026-02-15-abc123.zip</p>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={onInputChange}
      />

      {selectedFile && (
        <div className="mt-5 rounded-2xl border border-white/15 bg-[#0a1430] p-4 text-sm text-blue-100/90">
          <p className="font-semibold text-white">File selected</p>
          <p className="mt-1 break-all">{selectedFile.name}</p>
          <p className="mt-1 text-blue-100/70">{formatBytes(selectedFile.size)}</p>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onUpload}
          disabled={!selectedFile || uploading || Boolean(processing)}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-[#32a7ff] to-[#1576e8] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(21,118,232,0.38)] transition hover:from-[#45b1ff] hover:to-[#1a7ff1] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {uploading ? 'Uploading...' : 'Upload & Back Up'}
        </button>
        <p className="text-xs text-blue-100/70">Your archive is uploaded securely and processed in your account.</p>
      </div>

      {uploading && (
        <div className="mt-4 rounded-2xl border border-blue-400/35 bg-blue-500/10 p-4">
          <div className="flex items-center justify-between text-xs text-blue-100/85">
            <span>{uploadProgressDetail || 'Uploading archive...'}</span>
            <span>{Math.max(0, Math.min(100, uploadProgressPercent))}%</span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-cyan-300 transition-all"
              style={{ width: `${Math.max(0, Math.min(100, uploadProgressPercent))}%` }}
            />
          </div>
        </div>
      )}

      {processing && activeJob && (
        <div className="mt-6 rounded-2xl border border-blue-400/35 bg-blue-500/10 p-4">
          <p className="text-sm font-semibold text-blue-200">Processing your archive...</p>
          <div className="mt-3 h-2 w-full rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-blue-400 transition-all"
              style={{ width: `${Math.max(0, Math.min(100, activeJob.progress || 0))}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-blue-100/80">{activeJob.message || 'Running backup job...'}</p>
          <p className="mt-2 text-xs text-blue-100/75">
            Want to leave this wizard?
            {' '}
            <a href="/dashboard?tab=all-backups" className="font-semibold text-cyan-200 hover:underline">
              Go to Dashboard progress
            </a>
            .
          </p>
        </div>
      )}

      {uploadMessage && <p className="mt-4 text-sm text-emerald-300">{uploadMessage}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
    </section>
  )
}
