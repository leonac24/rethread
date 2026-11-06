import type { OutcomeAction, ScanResult } from '@/types/garment';
import { log } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { SCAN_TTL_MS, MAX_SCAN_BYTES } from '@/lib/config';

type StoredScan = {
  id: string;
  text: string;
  result: ScanResult;
  createdAt: number;
  outcome?: OutcomeAction;  // set once, immutable after first write
  outcomeAt?: number;
};

type StoredOutcome = { outcome: OutcomeAction; outcomeAt: number };

// Validated UUID v4 format — keeps arbitrary input out of Redis key names
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const scanKey = (id: string) => `scan:${id}`;
// Separate key so SET NX makes "first outcome wins" atomic across instances
const outcomeKey = (id: string) => `scan:${id}:outcome`;

export async function saveScanResult(text: string, result: ScanResult): Promise<string> {
  const id = result.id;
  const stored: StoredScan = { id, text, result, createdAt: Date.now() };
  const bytes = JSON.stringify(stored).length;

  if (bytes > MAX_SCAN_BYTES) {
    // The caller still returns the result inline; only a later GET /api/scan/:id will 404.
    log.warn('Scan result exceeds size limit, not storing', { id, bytes, limit: MAX_SCAN_BYTES });
    return id;
  }

  await redis().set(scanKey(id), stored, { px: SCAN_TTL_MS });
  return id;
}

export async function getScanById(id: string): Promise<StoredScan | null> {
  if (!UUID_RE.test(id)) throw new Error('Invalid scan ID format');

  const [scan, outcome] = await redis().mget<[StoredScan | null, StoredOutcome | null]>(
    scanKey(id), outcomeKey(id),
  );
  if (!scan || typeof scan.createdAt !== 'number' || !scan.result) return null;
  return outcome ? { ...scan, ...outcome } : scan;
}

export async function recordOutcome(
  id: string,
  action: OutcomeAction,
): Promise<{ conflict: boolean; stored: StoredScan | null }> {
  if (!UUID_RE.test(id)) throw new Error('Invalid scan ID format');

  const scan = await getScanById(id);
  if (!scan) return { conflict: false, stored: null };
  if (scan.outcome) return { conflict: true, stored: scan };

  const outcome: StoredOutcome = { outcome: action, outcomeAt: Date.now() };
  const written = await redis().set(outcomeKey(id), outcome, { px: SCAN_TTL_MS, nx: true });
  if (written === null) {
    // Lost the race to a concurrent request — report what actually got stored.
    return { conflict: true, stored: await getScanById(id) };
  }
  return { conflict: false, stored: { ...scan, ...outcome } };
}
