import * as Sentry from "@sentry/nextjs";

function readSampleRate(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const isProduction = process.env.NODE_ENV === "production";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NODE_ENV,
  tracesSampleRate: readSampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    isProduction ? 0.1 : 1.0,
  ),
  enableLogs: process.env.SENTRY_ENABLE_LOGS === "true",
  sendDefaultPii: false,
});
