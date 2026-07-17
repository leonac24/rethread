// POST /api/listings/[id]/offers
// Approved retailer makes a take-it-or-leave-it offer on an active listing.
// One open offer per retailer per listing; batch writes the offer doc, bumps
// the listing's offerCount, and mirrors listingOfferCount onto the owner's
// scan doc so the closet tile tag renders without extra queries.

import { verifyApprovedRetailer } from '@/lib/firebase/verify-retailer';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE } from '@/lib/marketplace';

export async function POST(
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

  const retailer = await verifyApprovedRetailer(request);
  if (!retailer) {
    return Response.json({ error: 'Approved retailer account required.' }, { status: 403 });
  }

  if (!FIRESTORE_ID_RE.test(id)) {
    return Response.json({ error: 'Invalid listing ID format.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const amountUsd = (body as Record<string, unknown> | null)?.amountUsd;
  if (
    typeof amountUsd !== 'number' ||
    !Number.isInteger(amountUsd) ||
    amountUsd < 1 ||
    amountUsd > 10000
  ) {
    return Response.json(
      { error: 'amountUsd must be a whole dollar amount between 1 and 10000.' },
      { status: 400 },
    );
  }

  const noteRaw = (body as Record<string, unknown>).note;
  let note: string | null = null;
  if (noteRaw !== undefined && noteRaw !== null) {
    if (typeof noteRaw !== 'string') {
      return Response.json({ error: 'note must be a string.' }, { status: 400 });
    }
    note = noteRaw.trim();
    if (note.length > 200) {
      return Response.json(
        { error: 'note must be 200 characters or fewer.' },
        { status: 400 },
      );
    }
  }

  try {
    const listingRef = db().collection('listings').doc(id);
    const snap = await listingRef.get();
    if (!snap.exists) {
      return Response.json({ error: 'Listing not found.' }, { status: 404 });
    }

    const listing = snap.data() as { ownerUid: string; scanId: string; status: string };
    if (listing.status !== 'active') {
      return Response.json(
        { error: 'This listing is no longer accepting offers.' },
        { status: 409 },
      );
    }

    const openSnap = await listingRef
      .collection('offers')
      .where('retailerUid', '==', retailer.uid)
      .where('status', '==', 'open')
      .get();
    if (!openSnap.empty) {
      return Response.json(
        { error: 'You already have an open offer on this listing.' },
        { status: 409 },
      );
    }

    const offerRef = listingRef.collection('offers').doc();
    const scanRef = db()
      .collection('users')
      .doc(listing.ownerUid)
      .collection('scans')
      .doc(listing.scanId);

    const batch = db().batch();
    batch.set(offerRef, {
      retailerUid: retailer.uid,
      storeName: retailer.storeName,
      storeLat: retailer.lat ?? null,
      storeLng: retailer.lng ?? null,
      amountUsd,
      ...(note ? { note } : {}),
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(listingRef, { offerCount: FieldValue.increment(1) });
    batch.set(scanRef, { listingOfferCount: FieldValue.increment(1) }, { merge: true });
    await batch.commit();

    return Response.json(
      { offer: { id: offerRef.id, amountUsd, status: 'open' } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[listings/:id/offers POST] Firestore error', {
      id,
      uid: retailer.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to create offer.' }, { status: 500 });
  }
}
