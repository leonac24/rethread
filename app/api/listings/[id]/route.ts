// GET   /api/listings/[id]  — owner-only listing detail with its offers.
// PATCH /api/listings/[id]  — owner cancels an active listing.
// Both 404 (not 403) for non-owners so listing IDs leak nothing.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE } from '@/lib/marketplace';

type ListingDoc = FirebaseFirestore.DocumentData & {
  ownerUid: string;
  scanId: string;
  status: string;
};

async function loadOwnedListing(request: Request, id: string) {
  if (!FIRESTORE_ID_RE.test(id)) {
    return { error: Response.json({ error: 'Invalid listing ID format.' }, { status: 400 }) };
  }
  const user = await verifyBearerToken(request);
  if (!user) {
    return { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
  }
  const listingRef = db().collection('listings').doc(id);
  const snap = await listingRef.get();
  const data = snap.exists ? (snap.data() as ListingDoc) : null;
  if (!data || data.ownerUid !== user.uid) {
    return { error: Response.json({ error: 'Listing not found.' }, { status: 404 }) };
  }
  return { user, listingRef, data };
}

function toMillis(v: unknown): number {
  return v && typeof (v as { toMillis?: () => number }).toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis()
    : 0;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const loaded = await loadOwnedListing(request, id);
    if ('error' in loaded) return loaded.error;
    const { listingRef, data } = loaded;

    const offersSnap = await listingRef.collection('offers').orderBy('createdAt', 'desc').get();
    const offers = offersSnap.docs.map((doc) => {
      const o = doc.data();
      return {
        id: doc.id,
        retailerUid: o.retailerUid,
        storeName: o.storeName,
        storeLat: o.storeLat ?? null,
        storeLng: o.storeLng ?? null,
        amountUsd: o.amountUsd,
        ...(o.note ? { note: o.note } : {}),
        status: o.status,
        createdAt: toMillis(o.createdAt),
      };
    });

    return Response.json({
      listing: {
        id,
        scanId: data.scanId,
        status: data.status,
        garment: data.garment ?? null,
        imageUrls: data.imageUrls ?? [],
        estimate: data.estimate ?? null,
        offerCount: data.offerCount ?? 0,
        acceptedOfferId: data.acceptedOfferId ?? null,
        fulfillment: data.fulfillment ?? null,
        dropoffCode: data.dropoffCode ?? null,
        shipping: data.shipping ?? null,
        finalAmountUsd: data.finalAmountUsd ?? null,
        createdAt: toMillis(data.createdAt),
      },
      offers,
    });
  } catch (err) {
    console.error('[listings/:id GET] Firestore error', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to retrieve listing.' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if ((body as Record<string, unknown> | null)?.status !== 'cancelled') {
    return Response.json({ error: 'Only { status: "cancelled" } is supported.' }, { status: 400 });
  }

  try {
    const loaded = await loadOwnedListing(request, id);
    if ('error' in loaded) return loaded.error;
    const { user, listingRef, data } = loaded;

    if (data.status !== 'active') {
      return Response.json(
        { error: `Cannot cancel a listing that is ${data.status}.` },
        { status: 409 },
      );
    }

    const scanRef = db()
      .collection('users')
      .doc(user.uid)
      .collection('scans')
      .doc(data.scanId);

    const batch = db().batch();
    batch.update(listingRef, { status: 'cancelled' });
    batch.set(scanRef, { listingStatus: 'cancelled' }, { merge: true });
    await batch.commit();

    return Response.json({ id, status: 'cancelled' });
  } catch (err) {
    console.error('[listings/:id PATCH] Firestore error', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to cancel listing.' }, { status: 500 });
  }
}
