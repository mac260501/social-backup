-- Create backup_jobs table for async archive/snapshot processing progress

CREATE TABLE IF NOT EXISTS public.backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('archive_upload', 'snapshot_scrape')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_backup_id uuid REFERENCES public.backups(id) ON DELETE SET NULL,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backup_jobs_user_created_idx
  ON public.backup_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS backup_jobs_user_status_idx
  ON public.backup_jobs (user_id, status);

ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own backup jobs" ON public.backup_jobs;
CREATE POLICY "Users can view their own backup jobs"
  ON public.backup_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own backup jobs" ON public.backup_jobs;
CREATE POLICY "Users can insert their own backup jobs"
  ON public.backup_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own backup jobs" ON public.backup_jobs;
CREATE POLICY "Users can update their own backup jobs"
  ON public.backup_jobs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
