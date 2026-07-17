// PATCH /api/listings/[id]/offers/[offerId] — { action: 'withdraw' }
// The offer's retailer withdraws their open offer. Decrements the listing's
// offerCount and the owner's scan-mirror listingOfferCount in the same batch.
// 404 (not 403) when the offer isn't theirs so offer IDs leak nothing.

import { verifyApprovedRetailer } from '@/lib/firebase/verify-retailer';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE } from '@/lib/marketplace';

export async function PATCH(
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

  const retailer = await verifyApprovedRetailer(request);
  if (!retailer) {
    return Response.json({ error: 'Approved retailer account required.' }, { status: 403 });
  }

  if (!FIRESTORE_ID_RE.test(id) || !FIRESTORE_ID_RE.test(offerId)) {
    return Response.json({ error: 'Invalid ID format.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if ((body as Record<string, unknown> | null)?.action !== 'withdraw') {
    return Response.json(
      { error: 'Only { action: "withdraw" } is supported.' },
      { status: 400 },
    );
  }

  try {
    const listingRef = db().collection('listings').doc(id);
    const offerRef = listingRef.collection('offers').doc(offerId);

    const offerSnap = await offerRef.get();
    const offer = offerSnap.exists
      ? (offerSnap.data() as { retailerUid: string; status: string })
      : null;
    if (!offer || offer.retailerUid !== retailer.uid) {
      return Response.json({ error: 'Offer not found.' }, { status: 404 });
    }
    if (offer.status !== 'open') {
      return Response.json(
        { error: `Cannot withdraw an offer that is ${offer.status}.` },
        { status: 409 },
      );
    }

    const listingSnap = await listingRef.get();
    const listing = listingSnap.exists
      ? (listingSnap.data() as { ownerUid?: string; scanId?: string })
      : null;

    const batch = db().batch();
    batch.update(offerRef, { status: 'withdrawn' });
    batch.update(listingRef, { offerCount: FieldValue.increment(-1) });
    if (listing?.ownerUid && listing?.scanId) {
      const scanRef = db()
        .collection('users')
        .doc(listing.ownerUid)
        .collection('scans')
        .doc(listing.scanId);
      batch.set(scanRef, { listingOfferCount: FieldValue.increment(-1) }, { merge: true });
    }
    await batch.commit();

    return Response.json({ id: offerId, status: 'withdrawn' });
  } catch (err) {
    console.error('[listings/:id/offers/:offerId PATCH] Firestore error', {
      id,
      offerId,
      uid: retailer.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to withdraw offer.' }, { status: 500 });
  }
}
