// POST /api/listings
// Creates a marketplace listing from one of the caller's closet scans.
// Denormalizes the garment snapshot so retailers never read user subcollections;
// mirrors { listingId, listingStatus } onto the scan doc in the same batch.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { roundCoord } from '@/lib/marketplace';
import type { ScanResult } from '@/types/garment';
import type { ListingGarment } from '@/types/marketplace';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
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

  const scanId = (body as Record<string, unknown> | null)?.scanId;
  if (typeof scanId !== 'string' || !UUID_RE.test(scanId)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  const latRaw = (body as Record<string, unknown>).lat;
  const lngRaw = (body as Record<string, unknown>).lng;
  const hasCoords =
    typeof latRaw === 'number' && Number.isFinite(latRaw) && Math.abs(latRaw) <= 90 &&
    typeof lngRaw === 'number' && Number.isFinite(lngRaw) && Math.abs(lngRaw) <= 180;

  try {
    const scanRef = db()
      .collection('users')
      .doc(user.uid)
      .collection('scans')
      .doc(scanId);

    const scanSnap = await scanRef.get();
    if (!scanSnap.exists) {
      return Response.json({ error: 'Scan not found.' }, { status: 404 });
    }

    const scanData = scanSnap.data() as {
      result?: ScanResult;
      imageUrls?: string[];
      listingId?: string;
      listingStatus?: string;
    };

    if (scanData.listingStatus === 'active' || scanData.listingStatus === 'accepted') {
      return Response.json({ error: 'This item is already listed.' }, { status: 409 });
    }

    const garmentSrc = scanData.result?.garment;
    const garment: ListingGarment = {
      fibers: garmentSrc?.fibers ?? [],
      ...(garmentSrc?.fibers_estimated ? { fibers_estimated: true } : {}),
      ...(garmentSrc?.brand ? { brand: garmentSrc.brand } : {}),
      ...(garmentSrc?.category ? { category: garmentSrc.category } : {}),
      ...(garmentSrc?.color ? { color: garmentSrc.color } : {}),
      ...(garmentSrc?.condition ? { condition: garmentSrc.condition } : {}),
    };

    const listingRef = db().collection('listings').doc();

    const batch = db().batch();
    batch.set(listingRef, {
      ownerUid: user.uid,
      scanId,
      status: 'active',
      garment,
      imageUrls: scanData.imageUrls ?? [],
      estimate: scanData.result?.cost?.resale ?? null,
      approxLocation: hasCoords
        ? { lat: roundCoord(latRaw as number), lng: roundCoord(lngRaw as number) }
        : null,
      offerCount: 0,
      acceptedRetailerUid: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      scanRef,
      { listingId: listingRef.id, listingStatus: 'active', listingOfferCount: 0 },
      { merge: true },
    );
    await batch.commit();

    return Response.json(
      { listing: { id: listingRef.id, scanId, status: 'active' } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[listings POST] Firestore error', {
      uid: user.uid,
      scanId,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to create listing.' }, { status: 500 });
  }
}
