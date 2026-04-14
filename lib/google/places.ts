import type { RouteKind, RouteOption } from '@/types/garment';
import { log } from '@/lib/logger';

// Maps + Places — nearest repair / resale / donation for the garment.
// Uses Places API (New) searchText with locationBias for distance-ranked results.

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

const QUERIES: Record<RouteKind, string> = {
  repair: 'clothing repair tailor',
  resale: 'consignment thrift store',
  donation: 'clothing donation center',
};

const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.types',
  'places.currentOpeningHours.weekdayDescriptions',
].join(',');

type PlacesResponse = {
  places?: Array<{
    displayName?: { text: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    rating?: number;
    types?: string[];
    currentOpeningHours?: { weekdayDescriptions?: string[] };
  }>;
};

export async function findRoutes(
  lat: number,
  lng: number,
  category: string | null,
): Promise<[RouteOption, RouteOption, RouteOption]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not set');

  const [repair, resale, donation] = await Promise.all([
    nearest('repair', lat, lng, category, apiKey),
    nearest('resale', lat, lng, category, apiKey),
    nearest('donation', lat, lng, category, apiKey),
  ]);

  return [repair, resale, donation];
}

async function nearest(
  kind: RouteKind,
  lat: number,
  lng: number,
  category: string | null,
  apiKey: string,
): Promise<RouteOption> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: QUERIES[kind],
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 5000,
        },
      },
      maxResultCount: 1,
      rankPreference: 'DISTANCE',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error('Places searchText failed', undefined, { stage: 'route', kind, status: res.status });
    throw new Error(
      `Places searchText failed for ${kind}: ${res.status} ${body}`,
    );
  }

  const data = (await res.json()) as PlacesResponse;
  const place = data.places?.[0];
  if (!place?.location) {
    throw new Error(`No ${kind} place found near ${lat},${lng}`);
  }

  return {
    kind,
    name: place.displayName?.text ?? 'Unknown',
    address: place.formattedAddress ?? '',
    distance_km: haversine(
      lat,
      lng,
      place.location.latitude,
      place.location.longitude,
    ),
    lat: place.location.latitude,
    lng: place.location.longitude,
    hours: place.currentOpeningHours?.weekdayDescriptions?.[todayIndex()],
    rating: place.rating,
    accepts_item: acceptsItem(kind, category, place.types ?? []),
  };
}

function todayIndex(): number {
  // Places API weekdayDescriptions is indexed 0=Monday..6=Sunday.
  // JS Date.getDay() is 0=Sunday..6=Saturday.
  return (new Date().getDay() + 6) % 7;
}

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

// Place types (Places API New) that each garment group is at home in.
const CLOTHING_TYPES = [
  'tailor',
  'clothing_store',
  'department_store',
  'shopping_mall',
];
const SHOE_TYPES = [
  'shoe_store',
  'clothing_store',
  'department_store',
  'shopping_mall',
];

function acceptsItem(
  kind: RouteKind,
  category: string | null,
  types: string[],
): boolean | null {
  if (kind === 'donation') return null;
  if (!category) return true;

  const c = category.toLowerCase();
  const isShoes = /shoe|sneaker|boot|sandal|heel|loafer|slipper|pump|oxford|clog/.test(c);
  const acceptable = isShoes ? SHOE_TYPES : CLOTHING_TYPES;
  return types.some((t) => acceptable.includes(t)) ? true : null;
}
