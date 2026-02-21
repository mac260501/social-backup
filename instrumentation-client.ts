import * as Sentry from "@sentry/nextjs";

function readSampleRate(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === "production";
const tracesSampleRate = readSampleRate(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  isProduction ? 0.1 : 1.0,
);
const replaysSessionSampleRate = readSampleRate(
  process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  isProduction ? 0.02 : 0.1,
);
const replaysOnErrorSampleRate = readSampleRate(
  process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
  1.0,
);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  integrations: [Sentry.replayIntegration()],
  tracesSampleRate,
  replaysSessionSampleRate,
  replaysOnErrorSampleRate,
  enableLogs: process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS === "true",
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
