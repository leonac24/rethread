// One-time lazy repair for legacy scan-image URLs.
// Early uploads stored Firebase tokenized download URLs
// (firebasestorage.googleapis.com), which 402 on the Spark plan. The files
// themselves live in GCS and are fine — this rewrites each legacy URL to a
// public storage.googleapis.com URL after making the object public.

import { adminStorage, storageBucketName } from './admin';

const LEGACY_HOST = 'https://firebasestorage.googleapis.com/';

// Extract the object path from a tokenized download URL:
// https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<url-encoded-path>?alt=media&token=…
export function legacyStoragePath(url: string): string | null {
  if (!url.startsWith(LEGACY_HOST)) return null;
  const match = /\/o\/([^?]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Returns the repaired array when anything changed, or null when there was
// nothing to repair. Files that fail to go public keep their original URL.
export async function repairLegacyImageUrls(imageUrls: string[]): Promise<string[] | null> {
  if (!imageUrls.some((url) => url.startsWith(LEGACY_HOST))) return null;

  const bucket = adminStorage().bucket(storageBucketName());
  let changed = false;

  const repaired = await Promise.all(
    imageUrls.map(async (url) => {
      const path = legacyStoragePath(url);
      if (!path) return url;
      try {
        await bucket.file(path).makePublic();
        changed = true;
        return `https://storage.googleapis.com/${bucket.name}/${path}`;
      } catch {
        return url;
      }
    }),
  );

  return changed ? repaired : null;
}
