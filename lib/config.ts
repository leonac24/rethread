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

// ─── Gemini ────────────────────────────────────────────────────────────────
// One multimodal super call does identification + eco analysis + appraisal,
// so it gets a longer leash than the old small single-purpose calls did.
export const GEMINI_TIMEOUT_MS = 45_000;

// ─── Shippo ────────────────────────────────────────────────────────────────
export const SHIPPO_TIMEOUT_MS = 20_000;
