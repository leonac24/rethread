// Structured JSON logger for consistent server-side output.
// Always include a `stage` field in ctx to identify pipeline step.
// Injects dd.trace_id and dd.span_id from the active Datadog span for log correlation.

import tracer from 'dd-trace';

function ddCorrelation(): Record<string, string> {
  const span = tracer.scope().active();
  if (!span) return {};
  const ctx = span.context();
  return {
    'dd.trace_id': ctx.toTraceId(),
    'dd.span_id': ctx.toSpanId(),
  };
}

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', msg, ...ddCorrelation(), ...ctx, ts: new Date().toISOString() })),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...ddCorrelation(), ...ctx, ts: new Date().toISOString() })),
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) =>
    console.error(
      JSON.stringify({
        level: 'error',
        msg,
        err: err instanceof Error ? err.message : String(err),
        ...ddCorrelation(),
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
