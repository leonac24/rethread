// Centralised backend constants — single source of truth.
// Import from here instead of scattering magic numbers across files.

// ─── Rate limiting ─────────────────────────────────────────────────────────
export const RATE_LIMIT = 5;           // max requests per window per IP
export const RATE_WINDOW_MS = 60_000;  // 1 minute
export const MAX_TRACKED_IPS = 10_000;

// ─── File uploads ──────────────────────────────────────────────────────────
export const MAX_UPLOAD_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Scan store ────────────────────────────────────────────────────────────
export const SCAN_TTL_MS = 30 * 60 * 1000;  // 30 minutes
export const MAX_SCAN_BYTES = 1_000_000;     // 1 MB per stored result

// ─── BigQuery ──────────────────────────────────────────────────────────────
export const BRAND_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const BIGQUERY_TIMEOUT_MS = 10_000;

// ─── Gemini ────────────────────────────────────────────────────────────────
export const GEMINI_TIMEOUT_MS = 20_000;
