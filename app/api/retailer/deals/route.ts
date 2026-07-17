// GET /api/retailer/deals
// The signed-in retailer's accepted and completed deals, newest first.
// Includes fulfillment details (pickup code / customer address / label) for
// this retailer's own deals; the user-facing estimate is never included.

import { verifyApprovedRetailer } from '@/lib/firebase/verify-retailer';
import { db } from '@/lib/firebase/admin';

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
    const snapshot = await db()
      .collection('listings')
      .where('acceptedRetailerUid', '==', retailer.uid)
      .get();

    const deals = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          status: d.status as string,
          garment: d.garment ?? null,
          imageUrls: (d.imageUrls as string[] | undefined) ?? [],
          fulfillment: d.fulfillment ?? null,
          dropoffCode: d.dropoffCode ?? null,
          shipFrom: d.shipFrom ?? null,
          shipping: d.shipping ?? null,
          acceptedAmountUsd: d.acceptedAmountUsd ?? null,
          finalAmountUsd: d.finalAmountUsd ?? null,
          acceptedAt: toMillis(d.acceptedAt),
          completedAt: toMillis(d.completedAt),
        };
      })
      // Status filtered in memory — a where-in clause would need a composite index.
      .filter((d) => d.status === 'accepted' || d.status === 'completed')
      .sort((a, b) => b.acceptedAt - a.acceptedAt);

    return Response.json({ deals });
  } catch (err) {
    console.error('[retailer/deals] Firestore error', {
      uid: retailer.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to retrieve deals.' }, { status: 500 });
  }
}
