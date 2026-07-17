// POST /api/listings/[id]/offers/[offerId]/accept
// Listing owner accepts a retailer's offer. Atomically: the offer flips to
// accepted, every other open offer is declined, the listing records the deal
// (fulfillment + dropoff code or ship-from address), and the closet mirror
// updates. The recorded amount becomes the kickback-ledger figure at completion.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE, generateDropoffCode } from '@/lib/marketplace';
import type { ShipFromAddress } from '@/types/marketplace';
import { FieldValue } from 'firebase-admin/firestore';

const ZIP_RE = /^\d{5}(-\d{4})?$/;

function parseShipFrom(value: unknown): ShipFromAddress | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const fields = ['name', 'street1', 'city', 'state', 'zip'] as const;
  for (const f of fields) {
    if (typeof v[f] !== 'string' || !(v[f] as string).trim() || (v[f] as string).length > 120) {
      return null;
    }
  }
  if (!ZIP_RE.test((v.zip as string).trim())) return null;
  return {
    name: (v.name as string).trim(),
    street1: (v.street1 as string).trim(),
    city: (v.city as string).trim(),
    state: (v.state as string).trim(),
    zip: (v.zip as string).trim(),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; offerId: string }> },
) {
  const { id, offerId } = await params;

  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  if (!FIRESTORE_ID_RE.test(id) || !FIRESTORE_ID_RE.test(offerId)) {
    return Response.json({ error: 'Invalid ID format.' }, { status: 400 });
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

  const fulfillment = (body as Record<string, unknown> | null)?.fulfillment;
  if (fulfillment !== 'dropoff' && fulfillment !== 'ship') {
    return Response.json({ error: 'fulfillment must be "dropoff" or "ship".' }, { status: 400 });
  }

  let shipFrom: ShipFromAddress | null = null;
  if (fulfillment === 'ship') {
    shipFrom = parseShipFrom((body as Record<string, unknown>).shipFrom);
    if (!shipFrom) {
      return Response.json(
        { error: 'A complete shipping address (name, street1, city, state, zip) is required.' },
        { status: 400 },
      );
    }
  }

  try {
    const listingRef = db().collection('listings').doc(id);
    const listingSnap = await listingRef.get();
    const listing = listingSnap.exists ? listingSnap.data()! : null;
    if (!listing || listing.ownerUid !== user.uid) {
      return Response.json({ error: 'Listing not found.' }, { status: 404 });
    }
    if (listing.status !== 'active') {
      return Response.json(
        { error: 'This listing is no longer accepting offers.' },
        { status: 409 },
      );
    }

    const offerRef = listingRef.collection('offers').doc(offerId);
    const offerSnap = await offerRef.get();
    const offer = offerSnap.exists ? offerSnap.data()! : null;
    if (!offer) {
      return Response.json({ error: 'Offer not found.' }, { status: 404 });
    }
    if (offer.status !== 'open') {
      return Response.json({ error: 'This offer is no longer open.' }, { status: 409 });
    }

    const openOffersSnap = await listingRef
      .collection('offers')
      .where('status', '==', 'open')
      .get();

    const dropoffCode = fulfillment === 'dropoff' ? generateDropoffCode() : undefined;

    const batch = db().batch();
    batch.update(offerRef, { status: 'accepted' });
    for (const doc of openOffersSnap.docs) {
      if (doc.id !== offerId) {
        batch.update(doc.ref, { status: 'declined' });
      }
    }
    batch.update(listingRef, {
      status: 'accepted',
      acceptedOfferId: offerId,
      acceptedRetailerUid: offer.retailerUid,
      acceptedAmountUsd: offer.amountUsd,
      fulfillment,
      acceptedAt: FieldValue.serverTimestamp(),
      ...(dropoffCode ? { dropoffCode } : {}),
      ...(shipFrom ? { shipFrom } : {}),
    });
    batch.set(
      db().collection('users').doc(user.uid).collection('scans').doc(listing.scanId),
      { listingStatus: 'accepted' },
      { merge: true },
    );
    await batch.commit();

    return Response.json({
      id: offerId,
      status: 'accepted',
      fulfillment,
      ...(dropoffCode ? { dropoffCode } : {}),
    });
  } catch (err) {
    console.error('[offers accept] Firestore error', {
      listingId: id,
      offerId,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to accept offer.' }, { status: 500 });
  }
}
