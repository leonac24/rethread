// POST /api/listings/[id]/received
// The accepted retailer confirms the garment arrived (drop-off or shipped).
// Completes the deal: records the final amount (the kickback-ledger figure),
// stamps completedAt, and updates the owner's closet mirror.

import { verifyApprovedRetailer } from '@/lib/firebase/verify-retailer';
import { db } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE } from '@/lib/marketplace';
import { FieldValue } from 'firebase-admin/firestore';

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

  if (!FIRESTORE_ID_RE.test(id)) {
    return Response.json({ error: 'Invalid listing ID format.' }, { status: 400 });
  }

  const retailer = await verifyApprovedRetailer(request);
  if (!retailer) {
    return Response.json({ error: 'Approved retailer account required.' }, { status: 403 });
  }

  try {
    const listingRef = db().collection('listings').doc(id);
    const snap = await listingRef.get();
    const listing = snap.exists ? snap.data()! : null;
    if (!listing || listing.acceptedRetailerUid !== retailer.uid) {
      return Response.json({ error: 'Deal not found.' }, { status: 404 });
    }
    if (listing.status !== 'accepted') {
      return Response.json(
        { error: 'Only an accepted deal can be marked received.' },
        { status: 409 },
      );
    }

    const batch = db().batch();
    batch.update(listingRef, {
      status: 'completed',
      finalAmountUsd: listing.acceptedAmountUsd ?? null,
      completedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      db().collection('users').doc(listing.ownerUid).collection('scans').doc(listing.scanId),
      { listingStatus: 'completed' },
      { merge: true },
    );
    await batch.commit();

    return Response.json({
      id,
      status: 'completed',
      finalAmountUsd: listing.acceptedAmountUsd ?? null,
    });
  } catch (err) {
    console.error('[listings received] Firestore error', {
      listingId: id,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to complete deal.' }, { status: 500 });
  }
}
