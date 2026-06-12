// Pure utility — no I/O, no side effects.
// Callers are expected to pass only verified partners (status === 'verified').
// No status filtering is performed here.

import type { RouteKind, RouteOption } from '@/types/garment';
import type { PartnerRecord } from '@/types/partner';

export const PARTNER_RADIUS_KM = 25;

// Haversine great-circle distance in km.
// lib/google/places.ts has an equivalent private helper; keeping this local
// avoids coupling to that module's internals.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Maps partner type to the route kind it should replace.
const PARTNER_KIND_MAP: Record<string, RouteKind> = {
  repair: 'repair',
  resale: 'resale',
  donation: 'donation',
  recycler: 'donation',
};

export function applyVerifiedPartners(
  routes: [RouteOption, RouteOption, RouteOption],
  partners: Array<{ id: string } & PartnerRecord>,
  lat: number,
  lng: number,
): [RouteOption, RouteOption, RouteOption] {
  // Work on a shallow copy so the input tuple is never mutated.
  const result: [RouteOption, RouteOption, RouteOption] = [...routes] as [RouteOption, RouteOption, RouteOption];

  // Group partners by the route kind they map to, keeping only those with
  // finite coords within the search radius.
  const byKind = new Map<RouteKind, Array<{ partner: { id: string } & PartnerRecord; distKm: number }>>();

  for (const partner of partners) {
    const routeKind = partner.type ? PARTNER_KIND_MAP[partner.type] : undefined;
    if (!routeKind) continue;

    const pLat = partner.lat;
    const pLng = partner.lng;
    if (pLat == null || pLng == null || !Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

    const distKm = haversineKm(lat, lng, pLat, pLng);
    if (distKm > PARTNER_RADIUS_KM) continue;

    const bucket = byKind.get(routeKind) ?? [];
    bucket.push({ partner, distKm });
    byKind.set(routeKind, bucket);
  }

  // For each route slot, replace with the nearest in-radius partner if one exists.
  for (let i = 0; i < result.length; i++) {
    const kind = result[i]!.kind;
    const candidates = byKind.get(kind);
    if (!candidates || candidates.length === 0) continue;

    // Pick nearest.
    candidates.sort((a, b) => a.distKm - b.distKm);
    const { partner: p, distKm: d } = candidates[0]!;

    result[i] = {
      kind,
      name: p.businessName,
      address: p.address ?? '',
      distance_km: Math.round(d * 10) / 10,
      lat: p.lat,
      lng: p.lng,
      accepts_item: null,
      verified: true,
      partnerId: p.id,
      discountPct: p.discountPct ?? 5,
    };
  }

  return result;
}
