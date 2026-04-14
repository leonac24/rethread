import type { ScanResult } from '@/types/garment';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { log } from '@/lib/logger';
import { SCAN_TTL_MS, MAX_SCAN_BYTES } from '@/lib/config';

type StoredScan = {
  id: string;
  text: string;
  result: ScanResult;
  createdAt: number;
};

const scans = new Map<string, StoredScan>();
// Use os.tmpdir() for cross-platform correctness (Linux /tmp, Windows %TEMP%)
const STORE_DIR = join(tmpdir(), '.scan-cache');

// Validated UUID v4 format — prevents path traversal via scan ID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let storeDirReady = false;
async function ensureStoreDir() {
  if (!storeDirReady) {
    // mode 0o700: owner-only access — scan files contain garment analysis data
    await mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
    storeDirReady = true;
  }
}

function scanFilePath(id: string) {
  return join(STORE_DIR, `${id}.json`);
}

// Collect expired IDs synchronously (Map mutation is single-threaded safe),
// then fire-and-forget file deletions. No boolean flag needed — the Map
// mutation itself is the critical section and Node's event loop serialises it.
function pruneExpired(now: number): void {
  const expired: string[] = [];
  for (const [id, scan] of scans) {
    if (now - scan.createdAt > SCAN_TTL_MS) {
      scans.delete(id);
      expired.push(id);
    }
  }
  for (const id of expired) {
    unlink(scanFilePath(id)).catch((err: NodeJS.ErrnoException) => {
      if (err?.code !== 'ENOENT') {
        log.warn('Failed to delete expired scan file', { id, err: err.message });
      }
    });
  }
}

export async function saveScanResult(text: string, result: ScanResult): Promise<string> {
  const now = Date.now();
  await ensureStoreDir();
  pruneExpired(now);

  const id = result.id;
  const stored: StoredScan = { id, text, result, createdAt: now };
  // Compact JSON — no pretty-printing; saves ~30% storage with no read-side impact
  const serialized = JSON.stringify(stored);

  if (serialized.length > MAX_SCAN_BYTES) {
    log.warn('Scan result exceeds size limit, skipping disk write', {
      id,
      bytes: serialized.length,
      limit: MAX_SCAN_BYTES,
    });
    scans.set(id, stored);
    return id;
  }

  scans.set(id, stored);
  await writeFile(scanFilePath(id), serialized, 'utf8');
  return id;
}

export async function getScanById(id: string): Promise<StoredScan | null> {
  if (!UUID_RE.test(id)) {
    throw new Error('Invalid scan ID format');
  }

  const now = Date.now();
  pruneExpired(now);

  const inMemory = scans.get(id);
  if (inMemory) {
    if (now - inMemory.createdAt > SCAN_TTL_MS) {
      scans.delete(id);
      return null;
    }
    return inMemory;
  }

  const filePath = scanFilePath(id);
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as StoredScan;

    if (now - parsed.createdAt > SCAN_TTL_MS) {
      // Best-effort delete — log unexpected failures
      unlink(filePath).catch((err: NodeJS.ErrnoException) => {
        if (err?.code !== 'ENOENT') {
          log.warn('Failed to delete expired scan file on read path', { id, err: err.message });
        }
      });
      return null;
    }

    scans.set(id, parsed);
    return parsed;
  } catch (err) {
    // ENOENT is expected (cache miss) — everything else is a real problem
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      log.warn('Unexpected error reading scan file', { id, err: (err as Error).message });
    }
    return null;
  }
}
