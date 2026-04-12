'use server';

import type { ScanResult } from '@/types/garment';

// Full pipeline: photo -> ingest -> cost -> route -> result.
// 1. lib/google/vision.ts   (or lib/google/docai.ts for receipts)
// 2. lib/google/gemini.ts   (grounded by lib/google/bigquery.ts)
// 3. lib/google/places.ts

export async function scan(_formData: FormData): Promise<ScanResult> {
  throw new Error('Not implemented');
}
