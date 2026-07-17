// POST /api/scan/[id]/images
// Uploads the scan's compressed photos server-side via the Admin SDK.
// Client-side Storage-SDK uploads are subject to security rules (the likely
// cause of silently image-less closet items); the Admin SDK bypasses rules,
// matching how every other write in this app works.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { adminStorage, storageBucketName } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGES = 4;
// Client compresses to ~≤300 KB JPEG; 3 MB of base64 (~2.2 MB binary) is generous.
const MAX_BASE64_CHARS = 3_000_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const images = (body as Record<string, unknown> | null)?.images;
  if (!Array.isArray(images) || images.length === 0 || images.length > MAX_IMAGES) {
    return Response.json(
      { error: `images must be an array of 1–${MAX_IMAGES} data URLs.` },
      { status: 400 },
    );
  }

  const parsed: Array<{ ext: string; buffer: Buffer }> = [];
  for (const image of images) {
    if (typeof image !== 'string' || image.length > MAX_BASE64_CHARS) {
      return Response.json({ error: 'Each image must be a compressed data URL.' }, { status: 400 });
    }
    const match = DATA_URL_RE.exec(image);
    if (!match) {
      return Response.json(
        { error: 'Images must be base64 data URLs (jpeg, png, or webp).' },
        { status: 400 },
      );
    }
    parsed.push({ ext: match[1], buffer: Buffer.from(match[2], 'base64') });
  }

  try {
    const bucket = adminStorage().bucket(storageBucketName());
    const imageUrls = await Promise.all(
      parsed.map(async ({ buffer }, index) => {
        const path = `scans/${user.uid}/${id}/${index}.jpg`;
        const token = crypto.randomUUID();
        const file = bucket.file(path);
        await file.save(buffer, {
          contentType: 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        // Prefer a public GCS URL: Firebase's tokenized download endpoint
        // (firebasestorage.googleapis.com) requires the Blaze plan on new
        // projects and 402s otherwise, while direct GCS serving works.
        try {
          await file.makePublic();
          return `https://storage.googleapis.com/${bucket.name}/${path}`;
        } catch {
          // Uniform bucket-level access blocks per-object ACLs — fall back
          // to the Firebase download-token URL.
          return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
        }
      }),
    );

    return Response.json({ imageUrls });
  } catch (err) {
    console.error('[scan images] upload failed', {
      uid: user.uid,
      scanId: id,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to upload images.' }, { status: 500 });
  }
}
