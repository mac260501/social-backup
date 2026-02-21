-- Disable legacy Supabase pg_cron reminder schedules.
-- Safe to run multiple times.
do $$
declare
  rec record;
begin
  for rec in
    select jobid
    from cron.job
    where jobname = 'archive_wizard_reminders_hourly'
       or command ilike '%/api/archive-wizard/reminders%'
  loop
    perform cron.unschedule(rec.jobid);
  end loop;
end
$$;
