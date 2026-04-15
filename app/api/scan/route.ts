import { analyzeGarmentImage, computeCost } from '@/lib/google/gemini';
import { getBrandContext } from '@/lib/google/bigquery';
import { findRoutes } from '@/lib/google/places';
import { parseClothingLabelText, readClothingLabelText } from '@/lib/google/vision';
import { saveScanResult } from '@/lib/scan-store';
import { createRequestLogger } from '@/lib/logger';
import { MAX_UPLOAD_FILES, MAX_FILE_BYTES } from '@/lib/config';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import type { RouteOption, ScanResult } from '@/types/garment';
import { prioritizeRoutesByCondition } from '@/lib/route-utils';

// ─── File validation ──────────────────────────────────────────────────────────
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
  // Assign a trace ID per request — all log lines from this request share it.
  // The ID is also returned as X-Trace-Id so clients can correlate with server logs.
  const traceId = crypto.randomUUID();
  const reqLog = createRequestLogger(traceId);

  const ip = getClientIp(request);

  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment before scanning again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter ?? 60), 'X-Trace-Id': traceId },
      },
    );
  }

  try {
    return await handleScan(request, reqLog, traceId);
  } catch (err) {
    reqLog.error('Unhandled scan error', err, { stage: 'scan' });
    const message = err instanceof Error ? err.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500, headers: { 'X-Trace-Id': traceId } });
  }
}

type ReqLog = ReturnType<typeof createRequestLogger>;

async function handleScan(request: Request, reqLog: ReqLog, traceId: string) {
  const formData = await request.formData();
  const files = formData.getAll('photo');
  const garmentPhotoFile = formData.get('garment_photo');

  if (!files.length && !(garmentPhotoFile instanceof File)) {
    return Response.json(
      { error: 'Provide at least one tag photo or a garment photo.' },
      { status: 400, headers: { 'X-Trace-Id': traceId } },
    );
  }

  // Enforce file count limit
  if (files.length > MAX_UPLOAD_FILES) {
    return Response.json(
      { error: `Too many files. Maximum ${MAX_UPLOAD_FILES} label photos allowed.` },
      { status: 400, headers: { 'X-Trace-Id': traceId } },
    );
  }

  // Validate each label photo: size + MIME type claim + magic bytes
  const labelBuffers: Buffer[] = [];
  for (const file of files) {
    if (!(file instanceof File)) {
      return Response.json({ error: 'All uploaded files must be images.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    if (file.size > MAX_FILE_BYTES) {
      return Response.json({ error: 'A file exceeds the 10 MB size limit.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'All uploaded files must be images.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isImageMagicBytes(buf)) {
      return Response.json({ error: 'One or more files are not valid images.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    labelBuffers.push(buf);
  }

  // Validate garment photo if provided
  let garmentPhotoBuffer: Buffer | null = null;
  if (garmentPhotoFile instanceof File && garmentPhotoFile.type.startsWith('image/')) {
    if (garmentPhotoFile.size > MAX_FILE_BYTES) {
      return Response.json({ error: 'The garment photo exceeds the 10 MB size limit.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    const buf = Buffer.from(await garmentPhotoFile.arrayBuffer());
    if (!isImageMagicBytes(buf)) {
      return Response.json(
        { error: 'The garment photo is not a valid image.' },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
      );
    }
    garmentPhotoBuffer = buf;
  }

  reqLog.info('Starting scan pipeline', { stage: 'ingest', labelCount: labelBuffers.length, hasGarmentPhoto: !!garmentPhotoBuffer });

  // [INGEST] OCR all label photos + optionally analyze garment image — run in parallel
  const [texts, imageAnalysis] = await Promise.all([
    Promise.all(
      labelBuffers.map((buf) =>
        readClothingLabelText(buf).catch((err) => {
          reqLog.error('Vision OCR failed for a label photo', err, { stage: 'ingest' });
          return '';
        }),
      ),
    ),
    garmentPhotoBuffer
      ? analyzeGarmentImage(garmentPhotoBuffer).catch((err) => {
          reqLog.error('Garment image analysis failed', err, { stage: 'ingest' });
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
    ...(imageAnalysis?.condition ? { condition: imageAnalysis.condition } : {}),
  };

  reqLog.info('Ingest complete', { stage: 'ingest', brand: garment.brand ?? null, category: garment.category });

  // [COST] Fetch brand context from BigQuery, then compute cost via Gemini — in parallel with routes
  const latRaw = formData.get('lat');
  const lngRaw = formData.get('lng');

  let routesPromise: Promise<ScanResult['routes']> = Promise.resolve(fallbackRoutes());

  if (typeof latRaw === 'string' && typeof lngRaw === 'string') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return Response.json({ error: 'lat and lng must be numeric values.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    } else if (!isValidCoords(lat, lng)) {
      return Response.json({ error: 'lat/lng out of valid geographic range.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    } else {
      reqLog.info('Using provided coords for route lookup', { stage: 'route', lat, lng });
      routesPromise = findRoutes(lat, lng, garment.category).catch((err) => {
        reqLog.error('findRoutes failed', err, { stage: 'route' });
        return fallbackRoutes();
      });
    }
  } else {
    reqLog.warn('No coords on request — using fallback routes', { stage: 'route' });
  }

  const costPromise: Promise<ScanResult['cost']> = getBrandContext(garment.brand ?? '')
    .catch((err) => {
      reqLog.warn('BigQuery brand context failed, proceeding without it', { stage: 'cost', err: err instanceof Error ? err.message : String(err) });
      return null;
    })
    .then((brandContext) => computeCost(garment, brandContext ?? undefined))
    .catch((err) => {
      reqLog.error('Gemini cost estimation failed, returning fallback', err, { stage: 'cost' });
      return {
        water_liters: 0,
        co2_kg: 0,
        dye_pollution_score: 1,
        confidence: 'low' as const,
        reasoning: 'Cost estimation unavailable. Showing fallback values.',
        disposal_co2_kg: 0,
        disposal_landfill_years: 0,
        disposal_note: 'Disposal impact unavailable.',
      };
    });

  const [cost, routes] = await Promise.all([costPromise, routesPromise]);

  const result: ScanResult = {
    id: crypto.randomUUID(),
    garment,
    cost,
    routes: prioritizeRoutesByCondition(routes, garment.condition),
  };

  const id = await saveScanResult(text, result);

  reqLog.info('Scan complete', { stage: 'scan', id });

  return Response.json({ id, text, result }, { headers: { 'X-Trace-Id': traceId } });
}
