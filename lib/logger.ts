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
