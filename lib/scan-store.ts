import type { ScanResult } from '@/types/garment';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type StoredScan = {
  id: string;
  text: string;
  result: ScanResult;
  createdAt: number;
};

const SCAN_TTL_MS = 1000 * 60 * 30;
const scans = new Map<string, StoredScan>();
const STORE_DIR = join('/tmp', '.scan-cache');

function ensureStoreDir() {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

function scanFilePath(id: string) {
  return join(STORE_DIR, `${id}.json`);
}

function pruneExpired(now: number) {
  for (const [id, scan] of scans) {
    if (now - scan.createdAt > SCAN_TTL_MS) {
      scans.delete(id);
      const filePath = scanFilePath(id);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  }
}

export function saveScanResult(text: string, result: ScanResult): string {
  const now = Date.now();
  ensureStoreDir();
  pruneExpired(now);

  const id = result.id;
  scans.set(id, {
    id,
    text,
    result,
    createdAt: now,
  });

  writeFileSync(
    scanFilePath(id),
    JSON.stringify(
      {
        id,
        text,
        result,
        createdAt: now,
      },
      null,
      2,
    ),
    'utf8',
  );

  return id;
}

export function getScanById(id: string): StoredScan | null {
  const now = Date.now();
  pruneExpired(now);

  const inMemory = scans.get(id);
  if (inMemory) {
    return inMemory;
  }

  const filePath = scanFilePath(id);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as StoredScan;

    if (now - parsed.createdAt > SCAN_TTL_MS) {
      unlinkSync(filePath);
      return null;
    }

    scans.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}
