// POST /api/listings/[id]/offers/[offerId]/decline
// Listing owner declines an open offer. The listing stays active.

import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE } from '@/lib/marketplace';

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

  try {
    const listingRef = db().collection('listings').doc(id);
    const listingSnap = await listingRef.get();
    const listing = listingSnap.exists ? listingSnap.data()! : null;
    if (!listing || listing.ownerUid !== user.uid) {
      return Response.json({ error: 'Listing not found.' }, { status: 404 });
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

    const batch = db().batch();
    batch.update(offerRef, { status: 'declined' });
    await batch.commit();

    return Response.json({ id: offerId, status: 'declined' });
  } catch (err) {
    console.error('[offers decline] Firestore error', {
      listingId: id,
      offerId,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to decline offer.' }, { status: 500 });
  }
}
