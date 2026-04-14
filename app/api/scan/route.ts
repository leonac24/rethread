import { analyzeGarmentImage, computeCost } from '@/lib/google/gemini';
import { getBrandContext } from '@/lib/google/bigquery';
import { findRoutes } from '@/lib/google/places';
import { parseClothingLabelText, readClothingLabelText } from '@/lib/google/vision';
import { saveScanResult } from '@/lib/scan-store';
import { log } from '@/lib/logger';
import type { RouteOption, ScanResult } from '@/types/garment';

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Max 5 requests per IP per minute. ipHits is capped and auto-evicts entries
// after their window expires to prevent unbounded memory growth.

const RATE_LIMIT = 5;
const WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 10_000;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // Evict all expired entries if the Map is at capacity
  if (ipHits.size >= MAX_TRACKED_IPS) {
    for (const [key, entry] of ipHits) {
      if (now > entry.resetAt) ipHits.delete(key);
    }
  }

  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + WINDOW_MS;
    ipHits.set(ip, { count: 1, resetAt });
    // Auto-evict this entry once the window expires
    setTimeout(() => {
      const current = ipHits.get(ip);
      if (current?.resetAt === resetAt) ipHits.delete(ip);
    }, WINDOW_MS);
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true };
}

// ─── File validation ──────────────────────────────────────────────────────────

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Validate image by magic bytes — file.type is user-controlled and can be forged
function isImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;
  return false;
}

// ─── Coordinate validation ────────────────────────────────────────────────────

function isValidCoords(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ─── Fallback routes ──────────────────────────────────────────────────────────

function fallbackRoutes(): [RouteOption, RouteOption, RouteOption] {
  return [
    { kind: 'repair', name: 'No repair route available', address: 'Location not provided', distance_km: 0, accepts_item: null },
    { kind: 'resale', name: 'No resale route available', address: 'Location not provided', distance_km: 0, accepts_item: null },
    { kind: 'donation', name: 'No donation route available', address: 'Location not provided', distance_km: 0, accepts_item: null },
  ];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Prefer X-Real-IP (set by reverse proxy, not spoofable by client) over X-Forwarded-For
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'unknown';

  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment before scanning again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter ?? 60) },
      },
    );
  }

  try {
    return await handleScan(request);
  } catch (err) {
    log.error('Unhandled scan error', err, { stage: 'scan' });
    const message = err instanceof Error ? err.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleScan(request: Request) {
  const formData = await request.formData();
  const files = formData.getAll('photo');
  const garmentPhotoFile = formData.get('garment_photo');

  if (!files.length && !(garmentPhotoFile instanceof File)) {
    return Response.json(
      { error: 'Provide at least one tag photo or a garment photo.' },
      { status: 400 },
    );
  }

  // Enforce file count limit
  if (files.length > MAX_FILES) {
    return Response.json(
      { error: `Too many files. Maximum ${MAX_FILES} label photos allowed.` },
      { status: 400 },
    );
  }

  // Validate each label photo: size + MIME type claim + magic bytes
  const labelBuffers: Buffer[] = [];
  for (const file of files) {
    if (!(file instanceof File)) {
      return Response.json({ error: 'All uploaded files must be images.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: `File "${file.name}" exceeds the 10 MB size limit.` },
        { status: 400 },
      );
    }
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'All uploaded files must be images.' }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isImageMagicBytes(buf)) {
      return Response.json(
        { error: `File "${file.name}" does not appear to be a valid image.` },
        { status: 400 },
      );
    }
    labelBuffers.push(buf);
  }

  // Validate garment photo if provided
  let garmentPhotoBuffer: Buffer | null = null;
  if (garmentPhotoFile instanceof File && garmentPhotoFile.type.startsWith('image/')) {
    if (garmentPhotoFile.size > MAX_FILE_BYTES) {
      return Response.json({ error: 'Garment photo exceeds the 10 MB size limit.' }, { status: 400 });
    }
    const buf = Buffer.from(await garmentPhotoFile.arrayBuffer());
    if (isImageMagicBytes(buf)) {
      garmentPhotoBuffer = buf;
    }
  }

  // [INGEST] OCR all label photos + optionally analyze garment image — run in parallel
  const [texts, imageAnalysis] = await Promise.all([
    Promise.all(
      labelBuffers.map((buf) =>
        readClothingLabelText(buf).catch((err) => {
          log.error('Vision OCR failed for a label photo', err, { stage: 'ingest' });
          return '';
        }),
      ),
    ),
    garmentPhotoBuffer
      ? analyzeGarmentImage(garmentPhotoBuffer).catch((err) => {
          log.error('Garment image analysis failed', err, { stage: 'ingest' });
          return null;
        })
      : Promise.resolve(null),
  ]);

  const text = texts.join('\n');
  const parsed = parseClothingLabelText(text);

  const garment: ScanResult['garment'] = {
    fibers: parsed.fibers ?? [],
    origin: parsed.origin ?? null,
    category: parsed.category ?? imageAnalysis?.category ?? null,
    ...(parsed.brand ? { brand: parsed.brand } : {}),
    ...(imageAnalysis?.color ? { color: imageAnalysis.color } : {}),
  };

  // [COST] Fetch brand context from BigQuery, then compute cost via Gemini — in parallel with routes
  const latRaw = formData.get('lat');
  const lngRaw = formData.get('lng');

  let routesPromise: Promise<ScanResult['routes']> = Promise.resolve(fallbackRoutes());

  if (typeof latRaw === 'string' && typeof lngRaw === 'string') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      log.warn('Coords present but not numeric', { stage: 'route', latRaw, lngRaw });
    } else if (!isValidCoords(lat, lng)) {
      log.warn('Coords out of valid range, using fallback routes', { stage: 'route', lat, lng });
    } else {
      log.info('Using provided coords for route lookup', { stage: 'route', lat, lng });
      routesPromise = findRoutes(lat, lng, garment.category).catch((err) => {
        log.error('findRoutes failed', err, { stage: 'route' });
        return fallbackRoutes();
      });
    }
  } else {
    log.warn('No coords on request — using fallback routes', { stage: 'route' });
  }

  const costPromise: Promise<ScanResult['cost']> = getBrandContext(garment.brand ?? '').then(
    (brandContext) => computeCost(garment, brandContext ?? undefined),
  ).catch(() => ({
    water_liters: 0,
    co2_kg: 0,
    dye_pollution_score: 1,
    confidence: 'low' as const,
    reasoning: 'Gemini cost estimation unavailable. Showing fallback values.',
  }));

  const [cost, routes] = await Promise.all([costPromise, routesPromise]);

  const result: ScanResult = {
    id: crypto.randomUUID(),
    garment,
    cost,
    routes,
  };

  const id = await saveScanResult(text, result);

  return Response.json({ id, text, result });
}
