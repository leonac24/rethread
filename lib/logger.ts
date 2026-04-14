// Structured JSON logger for consistent server-side output.
// Always include a `stage` field in ctx to identify pipeline step.

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', msg, ...ctx, ts: new Date().toISOString() })),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...ctx, ts: new Date().toISOString() })),
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) =>
    console.error(
      JSON.stringify({
        level: 'error',
        msg,
        err: err instanceof Error ? err.message : String(err),
        ...ctx,
        ts: new Date().toISOString(),
      }),
    ),
};

// Per-request logger that binds a traceId to every log line.
// Use this inside route handlers so all log lines from a single request
// share a common traceId — essential for debugging in production.
//
// Usage:
//   const reqLog = createRequestLogger(crypto.randomUUID());
//   reqLog.info('Processing scan', { stage: 'ingest' });
//
// The X-Trace-Id response header should be set to the same traceId so
// clients can correlate their request with server-side logs.

export type RequestLogger = ReturnType<typeof createRequestLogger>;

export function createRequestLogger(traceId: string) {
  return {
    info: (msg: string, ctx?: Record<string, unknown>) =>
      console.log(
        JSON.stringify({ level: 'info', msg, traceId, ...ctx, ts: new Date().toISOString() }),
      ),
    warn: (msg: string, ctx?: Record<string, unknown>) =>
      console.warn(
        JSON.stringify({ level: 'warn', msg, traceId, ...ctx, ts: new Date().toISOString() }),
      ),
    error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) =>
      console.error(
        JSON.stringify({
          level: 'error',
          msg,
          traceId,
          err: err instanceof Error ? err.message : String(err),
          ...ctx,
          ts: new Date().toISOString(),
        }),
      ),
  };
}
