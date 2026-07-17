import { analyzeGarment, type GarmentAnalysis } from '@/lib/google/gemini';
import { getFashionTransparencyScore } from '@/lib/wikirate';
import { findRoutes } from '@/lib/google/places';
import { parseClothingLabelText, readClothingLabelText } from '@/lib/google/vision';
import { computeFiberImpact } from '@/lib/fiber-impact';
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

function detectImageMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
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

  // Validate coords early — a bad request should never cost a Gemini call.
  const latRaw = formData.get('lat');
  const lngRaw = formData.get('lng');
  let coords: { lat: number; lng: number } | null = null;

  if (typeof latRaw === 'string' && typeof lngRaw === 'string') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return Response.json({ error: 'lat and lng must be numeric values.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    if (!isValidCoords(lat, lng)) {
      return Response.json({ error: 'lat/lng out of valid geographic range.' }, { status: 400, headers: { 'X-Trace-Id': traceId } });
    }
    coords = { lat, lng };
  }

  reqLog.info('Starting scan pipeline', { stage: 'ingest', labelCount: labelBuffers.length, hasGarmentPhoto: !!garmentPhotoBuffer });

  // [INGEST] OCR all label photos — the raw text feeds the super call as an
  // auxiliary signal (and the regex fallback if Gemini is unavailable).
  const texts = await Promise.all(
    labelBuffers.map((buf) =>
      readClothingLabelText(buf).catch((err) => {
        reqLog.error('Vision OCR failed for a label photo', err, { stage: 'ingest' });
        return '';
      }),
    ),
  );
  const text = texts.join('\n');

  // [ANALYZE] One multimodal Gemini call: identification, dye/disposal
  // analysis, landfill impact, and resale appraisal — all from the photos.
  const imageParts = [...labelBuffers, ...(garmentPhotoBuffer ? [garmentPhotoBuffer] : [])].map((buf) => ({
    mimeType: detectImageMime(buf),
    data: buf.toString('base64'),
  }));

  let analysis: GarmentAnalysis | null = null;
  try {
    analysis = await analyzeGarment(imageParts, { ocrText: text });
    reqLog.info('Garment analysis complete', {
      stage: 'analyze',
      brand: analysis.garment.brand,
      category: analysis.garment.category,
      fiberCount: analysis.garment.fibers.length,
    });
  } catch (err) {
    reqLog.error('Gemini garment analysis failed — falling back to regex label parse', err, { stage: 'analyze' });
  }

  let garment: ScanResult['garment'];
  if (analysis) {
    const g = analysis.garment;
    garment = {
      fibers: g.fibers,
      origin: g.origin,
      category: g.category,
      ...(g.brand ? { brand: g.brand } : {}),
      ...(g.color ? { color: g.color } : {}),
      ...(g.condition ? { condition: g.condition } : {}),
    };
  } else {
    const fallback = parseClothingLabelText(text);
    garment = {
      fibers: fallback.fibers ?? [],
      origin: fallback.origin ?? null,
      category: fallback.category ?? null,
      ...(fallback.brand ? { brand: fallback.brand } : {}),
    };
  }

  // [COST] Water and CO2 always come from the fiber lookup table — real LCA
  // data (Textile Exchange / Water Footprint Network), not AI estimates.
  const { water_liters, co2_kg } = computeFiberImpact(garment.fibers, garment.category);
  const cost: ScanResult['cost'] = analysis
    ? {
        water_liters,
        co2_kg,
        ...analysis.cost,
        ...(analysis.resale ? { resale: analysis.resale } : {}),
      }
    : {
        water_liters,
        co2_kg,
        dye_pollution_score: 1,
        confidence: 'low',
        reasoning: 'Environmental analysis unavailable. Showing lookup-table footprint only.',
        disposal_co2_kg: 0,
        disposal_landfill_years: 0,
        disposal_note: 'Disposal impact unavailable.',
      };

  // [ROUTE + FTI] Both depend on identification (category / brand), so they
  // start after the super call and run in parallel with each other.
  const routesPromise: Promise<ScanResult['routes']> = coords
    ? findRoutes(coords.lat, coords.lng, garment.category).catch((err) => {
        reqLog.error('findRoutes failed', err, { stage: 'route' });
        return fallbackRoutes();
      })
    : Promise.resolve(fallbackRoutes());
  if (!coords) reqLog.warn('No coords on request — using fallback routes', { stage: 'route' });

  const ftiPromise = getFashionTransparencyScore(garment.brand ?? '').catch((err) => {
    reqLog.warn('WikiRate FTI lookup failed', { stage: 'cost', err: String(err) });
    return null;
  });

  const [routes, fti] = await Promise.all([routesPromise, ftiPromise]);

  const result: ScanResult = {
    id: crypto.randomUUID(),
    garment,
    cost,
    routes: prioritizeRoutesByCondition(routes, garment.condition),
    ...(analysis ? { landfill_impact: analysis.landfill } : {}),
    ...(fti ? { fti } : {}),
  };

  const id = await saveScanResult(text, result);

  reqLog.info('Scan complete', { stage: 'scan', id });

  return Response.json({ id, text, result }, { headers: { 'X-Trace-Id': traceId } });
}
