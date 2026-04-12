import { computeCost } from '@/lib/google/gemini';
import { findRoutes } from '@/lib/google/places';
import { parseClothingLabelText, readClothingLabelText } from '@/lib/google/vision';
import { saveScanResult } from '@/lib/scan-store';
import type { RouteOption, ScanResult } from '@/types/garment';

function fallbackRoutes(): [RouteOption, RouteOption, RouteOption] {
  return [
    {
      kind: 'repair',
      name: 'No repair route available',
      address: 'Location not provided',
      distance_km: 0,
      accepts_item: null,
    },
    {
      kind: 'resale',
      name: 'No resale route available',
      address: 'Location not provided',
      distance_km: 0,
      accepts_item: null,
    },
    {
      kind: 'donation',
      name: 'No donation route available',
      address: 'Location not provided',
      distance_km: 0,
      accepts_item: null,
    },
  ];
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('photo');

  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing image file in field "photo".' }, { status: 400 });
  }

  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'Uploaded file must be an image.' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const image = Buffer.from(bytes);
  const text = await readClothingLabelText(image);
  const parsed = parseClothingLabelText(text);

  const garment: ScanResult['garment'] = {
    fibers: parsed.fibers ?? [],
    origin: parsed.origin ?? null,
    category: parsed.category ?? null,
    ...(parsed.brand ? { brand: parsed.brand } : {}),
  };

  const costPromise: Promise<ScanResult['cost']> = computeCost(garment).catch(
    () => ({
      water_liters: 0,
      co2_kg: 0,
      dye_pollution_score: 1,
      confidence: 'low',
      reasoning: 'Gemini cost estimation unavailable. Showing fallback values.',
    }),
  );

  let routesPromise: Promise<ScanResult['routes']> = Promise.resolve(fallbackRoutes());
  const latRaw = formData.get('lat');
  const lngRaw = formData.get('lng');
  console.log('[scan] received coords', { latRaw, lngRaw });
  if (typeof latRaw === 'string' && typeof lngRaw === 'string') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      routesPromise = findRoutes(lat, lng, garment.category).catch((err) => {
        console.error('[scan] findRoutes failed:', err);
        return fallbackRoutes();
      });
    } else {
      console.warn('[scan] coords present but not numeric:', { latRaw, lngRaw });
    }
  } else {
    console.warn('[scan] no coords on request — using fallback routes');
  }

  const [cost, routes] = await Promise.all([costPromise, routesPromise]);

  const result: ScanResult = {
    id: crypto.randomUUID(),
    garment,
    cost,
    routes,
  };

  const id = saveScanResult(text, result);

  return Response.json({ id, text, result });
}