'use server';

import { getBrandContext } from '@/lib/google/bigquery';
import { computeCost } from '@/lib/google/gemini';
import { findRoutes } from '@/lib/google/places';
import type { Garment, RouteOption, ScanResult } from '@/types/garment';

// Full pipeline: photo -> ingest -> cost -> route -> result.
// 1. lib/google/vision.ts   (or lib/google/docai.ts for receipts)
// 2. lib/google/gemini.ts   (grounded by lib/google/bigquery.ts)
// 3. lib/google/places.ts

function parseFibers(raw: string | null): Garment['fibers'] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const material =
          typeof (item as { material?: unknown }).material === 'string'
            ? (item as { material: string }).material.trim()
            : '';

        const percentageRaw = (item as { percentage?: unknown }).percentage;
        const percentage =
          typeof percentageRaw === 'number'
            ? percentageRaw
            : Number(percentageRaw ?? Number.NaN);

        if (!material || Number.isNaN(percentage)) {
          return null;
        }

        return {
          material,
          percentage: Math.max(0, Math.min(100, percentage)),
        };
      })
      .filter((fiber): fiber is { material: string; percentage: number } => Boolean(fiber));
  } catch {
    return [];
  }
}

function parseGarment(formData: FormData): Garment {
  const garmentJson = formData.get('garment_json');
  if (typeof garmentJson === 'string' && garmentJson.trim()) {
    try {
      const parsed = JSON.parse(garmentJson) as Partial<Garment>;
      return {
        fibers: Array.isArray(parsed.fibers) ? parsed.fibers : [],
        origin: parsed.origin ?? null,
        category: parsed.category ?? null,
        brand: parsed.brand,
        price: parsed.price,
      };
    } catch {
      throw new Error('garment_json must be valid JSON.');
    }
  }

  const fibers = parseFibers(
    typeof formData.get('fibers_json') === 'string'
      ? (formData.get('fibers_json') as string)
      : null,
  );

  const originRaw = formData.get('origin');
  const categoryRaw = formData.get('category');
  const brandRaw = formData.get('brand');
  const priceRaw = formData.get('price');

  return {
    fibers,
    origin: typeof originRaw === 'string' && originRaw.trim() ? originRaw.trim() : null,
    category:
      typeof categoryRaw === 'string' && categoryRaw.trim()
        ? categoryRaw.trim()
        : null,
    brand: typeof brandRaw === 'string' && brandRaw.trim() ? brandRaw.trim() : undefined,
    price:
      typeof priceRaw === 'string' && priceRaw.trim()
        ? Number(priceRaw)
        : undefined,
  };
}

function fallbackRoutes(): [RouteOption, RouteOption, RouteOption] {
  return [
    {
      kind: 'repair',
      name: 'No repair route available',
      address: 'Pending Places integration',
      distance_km: 0,
      accepts_item: false,
    },
    {
      kind: 'resale',
      name: 'No resale route available',
      address: 'Pending Places integration',
      distance_km: 0,
      accepts_item: false,
    },
    {
      kind: 'donation',
      name: 'No donation route available',
      address: 'Pending Places integration',
      distance_km: 0,
      accepts_item: false,
    },
  ];
}

export async function scan(_formData: FormData): Promise<ScanResult> {
  const garment = parseGarment(_formData);

  if (!garment.category || !garment.origin || garment.fibers.length === 0) {
    throw new Error(
      'Missing garment inputs. Provide fibers, origin, and category to compute environmental cost.',
    );
  }

  const brandContextPromise = garment.brand
    ? getBrandContext(garment.brand).catch(() => null)
    : Promise.resolve(null);

  const costPromise = brandContextPromise.then((brandContext) =>
    computeCost(garment, brandContext ?? undefined),
  );

  const latRaw = _formData.get('lat');
  const lngRaw = _formData.get('lng');

  let routes: [RouteOption, RouteOption, RouteOption] = fallbackRoutes();
  if (typeof latRaw === 'string' && typeof lngRaw === 'string') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      try {
        routes = await findRoutes(lat, lng, garment.category);
      } catch {
        routes = fallbackRoutes();
      }
    }
  }

  const cost = await costPromise;

  return {
    id: globalThis.crypto.randomUUID(),
    garment,
    cost,
    routes,
  };
}
