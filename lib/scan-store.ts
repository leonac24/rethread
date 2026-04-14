import type { ScanResult } from '@/types/garment';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '@/lib/logger';

type StoredScan = {
  id: string;
  text: string;
  result: ScanResult;
  createdAt: number;
};

const SCAN_TTL_MS = 1000 * 60 * 30;
const MAX_RESULT_BYTES = 1_000_000; // 1 MB
const scans = new Map<string, StoredScan>();
const STORE_DIR = join('/tmp', '.scan-cache');

// Validated UUID v4 format — prevents path traversal via scan ID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let storeDirReady = false;
async function ensureStoreDir() {
  if (!storeDirReady) {
    await mkdir(STORE_DIR, { recursive: true });
    storeDirReady = true;
  }
}

function scanFilePath(id: string) {
  return join(STORE_DIR, `${id}.json`);
}

let isPruning = false;
function pruneExpired(now: number) {
  if (isPruning) return;
  isPruning = true;
  try {
    for (const [id, scan] of scans) {
      if (now - scan.createdAt > SCAN_TTL_MS) {
        scans.delete(id);
        unlink(scanFilePath(id)).catch((err: NodeJS.ErrnoException) => {
          if (err?.code !== 'ENOENT') {
            log.warn('Failed to delete expired scan file', { id, err: err.message });
          }
        });
      }
    }
  } finally {
    isPruning = false;
  }
}

export async function saveScanResult(text: string, result: ScanResult): Promise<string> {
  const now = Date.now();
  await ensureStoreDir();
  pruneExpired(now);

  const id = result.id;
  const stored: StoredScan = { id, text, result, createdAt: now };
  const serialized = JSON.stringify(stored, null, 2);

  if (serialized.length > MAX_RESULT_BYTES) {
    log.warn('Scan result exceeds size limit, skipping disk write', {
      id,
      bytes: serialized.length,
      limit: MAX_RESULT_BYTES,
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
      unlink(filePath).catch(() => {});
      return null;
    }

    scans.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}
