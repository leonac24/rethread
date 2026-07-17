// GET /api/retailer/listings
// Active-listing feed for approved retailers, nearest-first from their store.
// Strips estimate, ownerUid, scanId, shipFrom, and dropoffCode — retailers
// never see the owner's identity, address, or the payout estimate.

import { verifyApprovedRetailer } from '@/lib/firebase/verify-retailer';
import { db } from '@/lib/firebase/admin';
import { haversineKm } from '@/lib/marketplace';

function toMillis(v: unknown): number {
  return v && typeof (v as { toMillis?: () => number }).toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis()
    : 0;
}

export async function GET(request: Request) {
  const retailer = await verifyApprovedRetailer(request);
  if (!retailer) {
    return Response.json({ error: 'Approved retailer account required.' }, { status: 403 });
  }

  try {
    const snap = await db().collection('listings').where('status', '==', 'active').get();

    const listings = snap.docs.map((doc) => {
      const data = doc.data();
      const loc = data.approxLocation as { lat?: unknown; lng?: unknown } | null | undefined;
      const distanceKm =
        retailer.lat !== null &&
        retailer.lng !== null &&
        typeof loc?.lat === 'number' &&
        typeof loc?.lng === 'number'
          ? Math.round(haversineKm(retailer.lat, retailer.lng, loc.lat, loc.lng) * 10) / 10
          : null;
      return {
        id: doc.id,
        garment: data.garment ?? null,
        imageUrls: data.imageUrls ?? [],
        condition: data.garment?.condition ?? null,
        createdAt: toMillis(data.createdAt),
        distanceKm,
      };
    });

    // Nearest first, unlocated listings last, newest first within ties.
    listings.sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }
      if (a.distanceKm === null && b.distanceKm !== null) return 1;
      if (a.distanceKm !== null && b.distanceKm === null) return -1;
      return b.createdAt - a.createdAt;
    });

    return Response.json({ listings });
  } catch (err) {
    console.error('[retailer/listings GET] Firestore error', {
      uid: retailer.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to load listings.' }, { status: 500 });
  }
}
