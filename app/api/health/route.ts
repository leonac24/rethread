// GET /api/health
// Lightweight liveness probe. Returns 200 when the server is up.
// Does NOT check external dependencies (Gemini, BigQuery, Vision) — those are
// checked lazily at request time so a cold-start dependency outage doesn't
// take down the health check itself.
//
// For a deeper readiness probe (e.g. Kubernetes readinessProbe), call this
// endpoint and assert { status: 'ok' } in the response body.

export const runtime = 'nodejs';

export function GET() {
  return Response.json(
    {
      status: 'ok',
      ts: new Date().toISOString(),
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
    },
    {
      status: 200,
      headers: {
        // Prevent caches from serving stale health responses
        'Cache-Control': 'no-store',
      },
    },
  );
}
